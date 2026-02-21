import { formatTime } from '../utils/format.js';

const EQ_BAND_FREQUENCIES = [101, 240, 397, 735, 1360, 2520, 4670, 11760, 16000];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const dbToGain = db => Math.pow(10, (Number(db) || 0) / 20);

export class AudioEngine {
  constructor({
    onTimeUpdate = () => {},
    onTrackChange = () => {},
    onPlaybackState = () => {},
    onEnded = () => {}
  } = {}) {
    this.onTimeUpdate = onTimeUpdate;
    this.onTrackChange = onTrackChange;
    this.onPlaybackState = onPlaybackState;
    this.onEnded = onEnded;

    this.audioContext = null;
    this.masterGain = null;
    this.preampGain = null;
    this.eqFilters = [];
    this.eqEnabled = true;
    this.eqState = {
      preamp: 0,
      bands: EQ_BAND_FREQUENCIES.map(() => 0)
    };

    this.channels = [
      { audio: new Audio(), source: null, songGain: null, loadedSong: null, loadedUrl: null },
      { audio: new Audio(), source: null, songGain: null, loadedSong: null, loadedUrl: null }
    ];

    this.channels.forEach(channel => {
      channel.audio.preload = 'auto';
      channel.audio.crossOrigin = 'anonymous';
      channel.audio.addEventListener('play', () => this.emitPlaybackState(true));
      channel.audio.addEventListener('pause', () => this.emitPlaybackState(false));
    });

    this.activeIndex = 0;
    this.standbyIndex = 1;
    this.currentSong = null;
    this.nextResolver = null;
    this.isCrossfading = false;
    this.crossfadeSeconds = 4;
    this.volume = 1;
  }

  async ensureContext() {
    if (!this.audioContext) {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioContextCtor();

      this.masterGain = this.audioContext.createGain();
      this.preampGain = this.audioContext.createGain();
      this.masterGain.gain.value = this.volume;

      let eqInput = this.preampGain;
      this.eqFilters = EQ_BAND_FREQUENCIES.map((frequency, index) => {
        const filter = this.audioContext.createBiquadFilter();
        filter.type = index === 0 ? 'lowshelf' : index === EQ_BAND_FREQUENCIES.length - 1 ? 'highshelf' : 'peaking';
        filter.frequency.value = frequency;
        filter.Q.value = 1;
        eqInput.connect(filter);
        eqInput = filter;
        return filter;
      });

      eqInput.connect(this.masterGain);
      this.masterGain.connect(this.audioContext.destination);

      this.channels.forEach(channel => {
        channel.source = this.audioContext.createMediaElementSource(channel.audio);
        channel.songGain = this.audioContext.createGain();
        channel.songGain.gain.value = 0;
        channel.source.connect(channel.songGain);
        channel.songGain.connect(this.preampGain);
      });

      this.applyEqState();
    }

    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
  }

  setNextResolver(resolver) {
    this.nextResolver = resolver;
  }

  setCrossfadeSeconds(seconds) {
    this.crossfadeSeconds = clamp(Number(seconds) || 0, 0, 8);
  }

  setVolume(value) {
    this.volume = clamp(Number(value), 0, 1);
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(this.volume, this.audioContext.currentTime, 0.02);
    }
  }

  setEqEnabled(enabled) {
    this.eqEnabled = Boolean(enabled);
    this.applyEqState();
  }

  setEqState(eqState) {
    this.eqState = {
      preamp: Number(eqState.preamp) || 0,
      bands: EQ_BAND_FREQUENCIES.map((_, index) => Number(eqState.bands?.[index]) || 0)
    };
    this.applyEqState();
  }

  applyEqState() {
    if (!this.audioContext || !this.preampGain || !this.eqFilters.length) return;
    const now = this.audioContext.currentTime;
    const preampDb = this.eqEnabled ? this.eqState.preamp : 0;
    this.preampGain.gain.setTargetAtTime(dbToGain(preampDb), now, 0.02);

    this.eqFilters.forEach((filter, index) => {
      const bandDb = this.eqEnabled ? this.eqState.bands[index] : 0;
      filter.gain.setTargetAtTime(bandDb, now, 0.02);
    });
  }

  get activeChannel() {
    return this.channels[this.activeIndex];
  }

  get standbyChannel() {
    return this.channels[this.standbyIndex];
  }

  getCurrentTiming() {
    const audio = this.activeChannel.audio;
    return {
      currentTime: audio.currentTime || 0,
      duration: audio.duration || 0,
      currentLabel: formatTime(audio.currentTime || 0),
      durationLabel: formatTime(audio.duration || 0)
    };
  }

  async loadChannel(channel, song, url) {
    channel.loadedSong = song;
    channel.loadedUrl = url;
    channel.audio.src = url;
    channel.audio.load();
    await new Promise(resolve => {
      const onReady = () => {
        channel.audio.removeEventListener('loadedmetadata', onReady);
        resolve(null);
      };
      channel.audio.addEventListener('loadedmetadata', onReady);
    });
  }

  async playSong(song, url) {
    await this.ensureContext();
    this.stopAll();

    const active = this.activeChannel;
    await this.loadChannel(active, song, url);

    active.songGain.gain.value = dbToGain(Number(song.normalize_gain_db) || 0);
    active.audio.currentTime = 0;

    this.currentSong = song;
    this.bindActiveEvents();
    await active.audio.play();
    this.onTrackChange(song);

    await this.warmUpNext();
  }

  async warmUpNext() {
    const standby = this.standbyChannel;
    standby.audio.pause();
    standby.audio.currentTime = 0;
    standby.loadedSong = null;
    standby.loadedUrl = null;

    if (!this.nextResolver) return;
    const payload = await this.nextResolver(this.currentSong);
    if (!payload || !payload.song || !payload.url) return;

    await this.loadChannel(standby, payload.song, payload.url);
    standby.songGain.gain.value = 0;
  }

  bindActiveEvents() {
    const active = this.activeChannel.audio;
    const standby = this.standbyChannel.audio;

    active.ontimeupdate = () => {
      this.onTimeUpdate(this.getCurrentTiming());
      this.tryCrossfade();
    };
    active.onended = async () => {
      if (this.isCrossfading) return;
      if (this.standbyChannel.loadedSong && this.standbyChannel.loadedUrl) {
        await this.startCrossfade(true);
      } else {
        this.onEnded();
      }
    };
    standby.ontimeupdate = null;
    standby.onended = null;
  }

  async tryCrossfade() {
    if (this.isCrossfading || this.crossfadeSeconds <= 0) return;
    const active = this.activeChannel;
    const standby = this.standbyChannel;
    if (!standby.loadedSong || !standby.loadedUrl) return;
    if (!Number.isFinite(active.audio.duration) || active.audio.duration <= 0) return;

    const remaining = active.audio.duration - active.audio.currentTime;
    if (remaining <= this.crossfadeSeconds) {
      await this.startCrossfade(false);
    }
  }

  async startCrossfade(forceImmediate) {
    if (this.isCrossfading) return;
    const from = this.activeChannel;
    const to = this.standbyChannel;
    if (!to.loadedSong || !to.loadedUrl) return;

    this.isCrossfading = true;
    const fadeDuration = forceImmediate ? 0.15 : Math.max(0.2, this.crossfadeSeconds);
    const fromBaseGain = dbToGain(Number(from.loadedSong?.normalize_gain_db) || 0);
    const toBaseGain = dbToGain(Number(to.loadedSong?.normalize_gain_db) || 0);

    to.audio.currentTime = 0;
    await to.audio.play();

    const start = performance.now();
    const step = now => {
      const progress = clamp((now - start) / (fadeDuration * 1000), 0, 1);
      const fromGain = fromBaseGain * (1 - progress);
      const toGain = toBaseGain * progress;
      from.songGain.gain.value = fromGain;
      to.songGain.gain.value = toGain;

      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        from.audio.pause();
        from.audio.currentTime = 0;
        from.songGain.gain.value = 0;

        const oldActive = this.activeIndex;
        this.activeIndex = this.standbyIndex;
        this.standbyIndex = oldActive;
        this.currentSong = this.activeChannel.loadedSong;
        this.bindActiveEvents();
        this.onTrackChange(this.currentSong);
        this.isCrossfading = false;
        this.warmUpNext().catch(console.warn);
      }
    };
    requestAnimationFrame(step);
  }

  async togglePlayPause() {
    await this.ensureContext();
    const active = this.activeChannel.audio;
    if (!active.src) return;
    if (active.paused) await active.play();
    else active.pause();
  }

  seekTo(percent) {
    const active = this.activeChannel.audio;
    if (!active.duration || !Number.isFinite(active.duration)) return;
    active.currentTime = clamp(percent, 0, 100) / 100 * active.duration;
    this.onTimeUpdate(this.getCurrentTiming());
  }

  stopAll() {
    this.channels.forEach(channel => {
      channel.audio.pause();
      channel.audio.currentTime = 0;
      if (channel.songGain) channel.songGain.gain.value = 0;
    });
    this.isCrossfading = false;
  }

  emitPlaybackState(isPlaying) {
    const active = this.activeChannel.audio;
    this.onPlaybackState(Boolean(isPlaying && !active.paused));
  }
}
