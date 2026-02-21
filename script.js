// ======= KONFIGURASI SUPABASE =======
const SUPABASE_URL = 'https://nhxjrrfmpeqsgapornxx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5oeGpycmZtcGVxc2dhcG9ybnh4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2NjAyMDcsImV4cCI6MjA4NzIzNjIwN30.qyw6zaXhmIGwPEQR17Bi4c4W7slUUty5Byth3PXEav4';
const SUPABASE_BUCKET = 'songs';
const SUPABASE_TABLE = 'songs';

const EQ_STORAGE_KEY = 'kingpin_eq_settings_v3';
const EQ_BANDS = [
    { frequency: 101, label: '101 Hz', type: 'lowshelf', q: 0.8 },
    { frequency: 240, label: '240 Hz', type: 'peaking', q: 1.0 },
    { frequency: 397, label: '397 Hz', type: 'peaking', q: 1.0 },
    { frequency: 735, label: '735 Hz', type: 'peaking', q: 1.0 },
    { frequency: 1360, label: '1.36 kHz', type: 'peaking', q: 1.0 },
    { frequency: 2520, label: '2.52 kHz', type: 'peaking', q: 1.0 },
    { frequency: 4670, label: '4.67 kHz', type: 'peaking', q: 1.0 },
    { frequency: 11760, label: '11.76 kHz', type: 'peaking', q: 1.0 },
    { frequency: 16000, label: '16.00 kHz', type: 'highshelf', q: 0.8 }
];

const EQ_PRESETS = {
    flat: {
        bands: [0, 0, 0, 0, 0, 0, 0, 0, 0],
        preamp: 0,
        effects: { clarity: 0, ambience: 0, surround: 0, dynamic: 0, bassBoost: 0 }
    },
    bass: {
        bands: [7, 5, 2, 0, -1, -1, -1, 0, 1],
        preamp: -2,
        effects: { clarity: 5, ambience: 0, surround: 10, dynamic: 18, bassBoost: 40 }
    },
    vocal: {
        bands: [-2, -1, 1, 3, 4, 3, 2, 1, 0],
        preamp: -1,
        effects: { clarity: 25, ambience: 22, surround: 8, dynamic: 12, bassBoost: 0 }
    },
    bright: {
        bands: [-1, -1, 0, 1, 2, 4, 6, 6, 5],
        preamp: -2,
        effects: { clarity: 45, ambience: 15, surround: 10, dynamic: 10, bassBoost: 0 }
    }
};

let supabaseClient = null;
let allSongs = [];
let currentSongIndex = -1;

let audioContext = null;
let sourceNode = null;
let inputGainNode = null;
let dryGainNode = null;
let wetGainNode = null;
let eqFilters = [];
let compressorNode = null;
let preampGainNode = null;

let savedEQPreset = null;
let eqState = createDefaultEQState();
let eqStatusTimeout = null;

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function createDefaultEQState() {
    return {
        enabled: true,
        preamp: 0,
        preset: 'flat',
        bands: EQ_BANDS.map(() => 0),
        effects: {
            clarity: 0,
            ambience: 0,
            surround: 0,
            dynamic: 0,
            bassBoost: 0
        }
    };
}

function normalizeEffects(effects) {
    return {
        clarity: clamp(Number(effects?.clarity) || 0, 0, 100),
        ambience: clamp(Number(effects?.ambience) || 0, 0, 100),
        surround: clamp(Number(effects?.surround) || 0, 0, 100),
        dynamic: clamp(Number(effects?.dynamic) || 0, 0, 100),
        bassBoost: clamp(Number(effects?.bassBoost) || 0, 0, 100)
    };
}

function normalizeEQState(candidate) {
    const fallback = createDefaultEQState();
    if (!candidate || typeof candidate !== 'object') return fallback;

    return {
        enabled: Boolean(candidate.enabled),
        preamp: clamp(Number(candidate.preamp) || 0, -12, 12),
        preset: typeof candidate.preset === 'string' ? candidate.preset : 'custom',
        bands: EQ_BANDS.map((_, index) => clamp(Number(candidate.bands?.[index]) || 0, -12, 12)),
        effects: normalizeEffects(candidate.effects)
    };
}

function cloneEQState(state) {
    return normalizeEQState({
        enabled: state.enabled,
        preamp: state.preamp,
        preset: state.preset,
        bands: [...state.bands],
        effects: { ...state.effects }
    });
}

function isSupabaseConfigured() {
    return (
        SUPABASE_URL &&
        SUPABASE_ANON_KEY &&
        !SUPABASE_URL.includes('PASTE_') &&
        !SUPABASE_ANON_KEY.includes('PASTE_')
    );
}

function initSupabase() {
    if (!window.supabase || !isSupabaseConfigured()) return false;
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return true;
}

function sanitizeFileName(name) {
    return name.replace(/[^\w.\-]/g, '_');
}

function formatTime(totalSeconds) {
    if (!Number.isFinite(totalSeconds)) return '0:00';
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatDb(value) {
    const num = Number(value) || 0;
    const sign = num >= 0 ? '+' : '';
    return `${sign}${num.toFixed(1)} dB`;
}

function setUploadStatus(text, color = '#b3b3b3') {
    const status = document.getElementById('uploadStatus');
    status.innerText = text;
    status.style.color = color;
}

function setSelectedFilesText(text) {
    const selectedFilesText = document.getElementById('selectedFilesText');
    selectedFilesText.innerText = text;
}

function setEQStatus(text, color = '#95a4bd') {
    const status = document.getElementById('eqStatusText');
    if (!status) return;

    status.innerText = text;
    status.style.color = color;

    if (eqStatusTimeout) clearTimeout(eqStatusTimeout);
    if (!text) return;

    eqStatusTimeout = setTimeout(() => {
        if (status.innerText === text) status.innerText = '';
    }, 2800);
}

function loadEQStorage() {
    try {
        const raw = localStorage.getItem(EQ_STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (parsed?.lastState) eqState = normalizeEQState(parsed.lastState);
        if (parsed?.savedPreset) savedEQPreset = normalizeEQState(parsed.savedPreset);
    } catch (error) {
        console.warn('Gagal load EQ setting dari localStorage:', error);
    }
}

function persistEQStorage() {
    try {
        localStorage.setItem(
            EQ_STORAGE_KEY,
            JSON.stringify({
                lastState: eqState,
                savedPreset: savedEQPreset
            })
        );
    } catch (error) {
        console.warn('Gagal simpan EQ setting:', error);
    }
}

function toSongView(row) {
    let streamUrl = row.url;
    if (!streamUrl && row.path) {
        const { data } = supabaseClient.storage.from(SUPABASE_BUCKET).getPublicUrl(row.path);
        streamUrl = data.publicUrl;
    }

    return {
        id: row.id,
        name: row.name || 'Untitled',
        path: row.path,
        url: streamUrl,
        mime_type: row.mime_type || '',
        size_bytes: row.size_bytes || 0,
        created_at: row.created_at
    };
}
function buildEQUI() {
    const gridLines = document.getElementById('eqGridLines');
    const dots = document.getElementById('eqCurveDots');
    const bandRow = document.getElementById('eqBandRow');

    if (!gridLines || !dots || !bandRow) return;

    gridLines.innerHTML = '';
    dots.innerHTML = '';
    bandRow.innerHTML = '';

    EQ_BANDS.forEach((band, index) => {
        const line = document.createElement('div');
        line.className = 'eq-grid-line';
        line.style.left = `${(index / (EQ_BANDS.length - 1)) * 100}%`;
        gridLines.appendChild(line);

        const dot = document.createElement('span');
        dot.className = 'eq-dot';
        dot.id = `eqDot-${index}`;
        dots.appendChild(dot);

        const cell = document.createElement('div');
        cell.className = 'eq-band-cell';
        cell.innerHTML = `
            <input type="range" class="eq-band-slider" id="eqBand-${index}" min="-12" max="12" step="0.5" value="0">
            <span class="eq-band-label">${band.label}</span>
            <span class="eq-band-value" id="eqBandValue-${index}">+0.0 dB</span>
        `;
        bandRow.appendChild(cell);
    });
}

function setPresetSelectValue(preset) {
    const presetSelect = document.getElementById('eqPresetSelect');
    if (!presetSelect) return;

    const allValues = Array.from(presetSelect.options).map(option => option.value);
    presetSelect.value = allValues.includes(preset) ? preset : 'custom';
}

function updateEffectLabels() {
    const clarity = document.getElementById('eqClarityValue');
    const ambience = document.getElementById('eqAmbienceValue');
    const surround = document.getElementById('eqSurroundValue');
    const dynamic = document.getElementById('eqDynamicValue');
    const bassBoost = document.getElementById('eqBassBoostValue');

    if (clarity) clarity.innerText = `${Math.round(eqState.effects.clarity)}%`;
    if (ambience) ambience.innerText = `${Math.round(eqState.effects.ambience)}%`;
    if (surround) surround.innerText = `${Math.round(eqState.effects.surround)}%`;
    if (dynamic) dynamic.innerText = `${Math.round(eqState.effects.dynamic)}%`;
    if (bassBoost) bassBoost.innerText = `${Math.round(eqState.effects.bassBoost)}%`;
}

function updatePowerUI() {
    const panel = document.getElementById('eqPanel');
    const powerBtn = document.getElementById('eqPowerBtn');

    if (panel) panel.classList.toggle('is-bypassed', !eqState.enabled);
    if (powerBtn) powerBtn.classList.toggle('is-off', !eqState.enabled);
}

function getEffectOffsets() {
    const offsets = EQ_BANDS.map(() => 0);

    const clarity = eqState.effects.clarity / 100;
    offsets[5] += clarity * 2.8;
    offsets[6] += clarity * 4.2;
    offsets[7] += clarity * 5.6;
    offsets[8] += clarity * 4.8;

    const ambience = eqState.effects.ambience / 100;
    offsets[3] += ambience * 1.5;
    offsets[4] += ambience * 2.6;
    offsets[5] += ambience * 2.4;
    offsets[6] += ambience * 1.6;

    const surround = eqState.effects.surround / 100;
    offsets[0] += surround * 1.2;
    offsets[1] += surround * 0.8;
    offsets[4] -= surround * 1.5;
    offsets[7] += surround * 2.1;
    offsets[8] += surround * 2.4;

    const bassBoost = eqState.effects.bassBoost / 100;
    offsets[0] += bassBoost * 9.2;
    offsets[1] += bassBoost * 7.3;
    offsets[2] += bassBoost * 3.8;
    offsets[3] += bassBoost * 1.7;

    return offsets;
}

function getEffectiveBandGains() {
    const offsets = getEffectOffsets();
    return eqState.bands.map((baseGain, index) => clamp(baseGain + offsets[index], -18, 18));
}

function renderEQCurve(effectiveGains) {
    const svg = document.getElementById('eqCurveSvg');
    const line = document.getElementById('eqCurveLine');
    const area = document.getElementById('eqCurveArea');
    if (!svg || !line || !area) return;

    const width = 900;
    const height = 230;
    const padX = 36;
    const topY = 26;
    const bottomY = 155;

    const points = effectiveGains.map((gain, index) => {
        const x = padX + (index / (EQ_BANDS.length - 1)) * (width - padX * 2);
        const y = topY + ((18 - gain) / 36) * (bottomY - topY);
        return { x, y };
    });

    line.setAttribute('points', points.map(point => `${point.x},${point.y}`).join(' '));
    area.setAttribute(
        'points',
        `${padX},${height - 12} ${points.map(point => `${point.x},${point.y}`).join(' ')} ${width - padX},${height - 12}`
    );

    points.forEach((point, index) => {
        const dot = document.getElementById(`eqDot-${index}`);
        if (dot) {
            dot.style.left = `${(point.x / width) * 100}%`;
            dot.style.top = `${(point.y / height) * 100}%`;
        }

        const valueLabel = document.getElementById(`eqBandValue-${index}`);
        if (valueLabel) valueLabel.innerText = formatDb(effectiveGains[index]);
    });
}

function applyDynamicCompressor() {
    if (!compressorNode) return;
    const amount = clamp(eqState.effects.dynamic / 100, 0, 1);
    compressorNode.threshold.value = -20 - amount * 30;
    compressorNode.knee.value = 20 + amount * 20;
    compressorNode.ratio.value = 1 + amount * 9;
    compressorNode.attack.value = 0.003 + amount * 0.02;
    compressorNode.release.value = 0.15 + amount * 0.5;
}

function applyEQStateToAudio() {
    const effectiveGains = getEffectiveBandGains();
    renderEQCurve(effectiveGains);

    const preampValue = document.getElementById('eqPreampValue');
    if (preampValue) preampValue.innerText = formatDb(eqState.preamp);
    updatePowerUI();

    if (!audioContext || !eqFilters.length || !preampGainNode || !wetGainNode || !dryGainNode) return;

    const now = audioContext.currentTime;
    eqFilters.forEach((filter, index) => {
        filter.gain.setTargetAtTime(effectiveGains[index], now, 0.02);
    });

    preampGainNode.gain.setTargetAtTime(Math.pow(10, eqState.preamp / 20), now, 0.02);
    applyDynamicCompressor();

    if (eqState.enabled) {
        wetGainNode.gain.setTargetAtTime(1, now, 0.02);
        dryGainNode.gain.setTargetAtTime(0, now, 0.02);
    } else {
        wetGainNode.gain.setTargetAtTime(0, now, 0.02);
        dryGainNode.gain.setTargetAtTime(1, now, 0.02);
    }
}

function syncEQControlsFromState() {
    setPresetSelectValue(eqState.preset);

    const preamp = document.getElementById('eqPreamp');
    const eqClarity = document.getElementById('eqClarity');
    const eqAmbience = document.getElementById('eqAmbience');
    const eqSurround = document.getElementById('eqSurround');
    const eqDynamic = document.getElementById('eqDynamic');
    const eqBassBoost = document.getElementById('eqBassBoost');

    if (preamp) preamp.value = String(eqState.preamp);
    if (eqClarity) eqClarity.value = String(eqState.effects.clarity);
    if (eqAmbience) eqAmbience.value = String(eqState.effects.ambience);
    if (eqSurround) eqSurround.value = String(eqState.effects.surround);
    if (eqDynamic) eqDynamic.value = String(eqState.effects.dynamic);
    if (eqBassBoost) eqBassBoost.value = String(eqState.effects.bassBoost);

    EQ_BANDS.forEach((_, index) => {
        const slider = document.getElementById(`eqBand-${index}`);
        if (slider) slider.value = String(eqState.bands[index]);
    });

    updateEffectLabels();
    applyEQStateToAudio();
}

function getPresetState(presetName) {
    const preset = EQ_PRESETS[presetName];
    if (!preset) return null;

    return normalizeEQState({
        enabled: true,
        preamp: preset.preamp,
        preset: presetName,
        bands: preset.bands,
        effects: preset.effects
    });
}

function markPresetCustom() {
    if (eqState.preset !== 'custom') {
        eqState.preset = 'custom';
        setPresetSelectValue('custom');
    }
}

function applyPreset(presetName) {
    if (presetName === 'custom') {
        eqState.preset = 'custom';
        persistEQStorage();
        return;
    }

    const preserveEnabled = eqState.enabled;
    if (presetName === 'saved') {
        if (!savedEQPreset) {
            setEQStatus('Belum ada setting EQ yang disimpan.', '#f59e0b');
            setPresetSelectValue(eqState.preset);
            return;
        }
        eqState = cloneEQState(savedEQPreset);
        eqState.enabled = preserveEnabled;
        eqState.preset = 'saved';
    } else {
        const presetState = getPresetState(presetName);
        if (!presetState) return;
        eqState = presetState;
        eqState.enabled = preserveEnabled;
    }

    syncEQControlsFromState();
    persistEQStorage();
    setEQStatus(`Preset ${eqState.preset.toUpperCase()} diterapkan.`, '#1DB954');
}

function saveCurrentEQSetting() {
    savedEQPreset = cloneEQState({
        ...eqState,
        preset: 'saved'
    });
    persistEQStorage();
    setEQStatus('Setting equalizer berhasil disimpan.', '#1DB954');
}

function resetEQ() {
    const preserveEnabled = eqState.enabled;
    const flat = getPresetState('flat');
    if (!flat) return;

    eqState = flat;
    eqState.enabled = preserveEnabled;
    eqState.preset = 'flat';

    syncEQControlsFromState();
    persistEQStorage();
    setEQStatus('Equalizer di-reset ke Flat.', '#9dc5ff');
}

function initAudioGraph() {
    const player = document.getElementById('audioPlayer');
    if (!player || audioContext) return;

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    player.crossOrigin = 'anonymous';

    audioContext = new AudioContextClass();
    sourceNode = audioContext.createMediaElementSource(player);

    inputGainNode = audioContext.createGain();
    dryGainNode = audioContext.createGain();
    wetGainNode = audioContext.createGain();
    preampGainNode = audioContext.createGain();
    compressorNode = audioContext.createDynamicsCompressor();

    eqFilters = EQ_BANDS.map(band => {
        const filter = audioContext.createBiquadFilter();
        filter.type = band.type;
        filter.frequency.value = band.frequency;
        filter.Q.value = band.q;
        filter.gain.value = 0;
        return filter;
    });

    sourceNode.connect(inputGainNode);

    inputGainNode.connect(dryGainNode);
    dryGainNode.connect(audioContext.destination);

    let chainNode = inputGainNode;
    eqFilters.forEach(filter => {
        chainNode.connect(filter);
        chainNode = filter;
    });

    chainNode.connect(compressorNode);
    compressorNode.connect(preampGainNode);
    preampGainNode.connect(wetGainNode);
    wetGainNode.connect(audioContext.destination);

    applyEQStateToAudio();
}

async function ensureAudioContextRunning() {
    initAudioGraph();
    if (audioContext && audioContext.state === 'suspended') {
        try {
            await audioContext.resume();
        } catch (error) {
            console.warn('Gagal resume AudioContext:', error);
        }
    }
    applyEQStateToAudio();
}

async function loadSongs() {
    const listContainer = document.getElementById('songList');

    if (!supabaseClient) {
        listContainer.innerHTML = '<p style="color: #ff6b6b; padding: 20px;">Isi config Supabase di script.js dulu.</p>';
        return;
    }

    listContainer.innerHTML = '<p class="loading-text"><i class="fas fa-spinner fa-spin"></i> Loading lagu dari Supabase...</p>';

    try {
        const { data, error } = await supabaseClient
            .from(SUPABASE_TABLE)
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        allSongs = (data || []).map(toSongView).filter(song => !!song.url);
        renderSongs(allSongs);
    } catch (error) {
        console.error(error);
        listContainer.innerHTML = '<p style="color: #ff6b6b; padding: 20px;">Gagal load lagu dari Supabase.</p>';
    }
}
function renderSongs(songsArray) {
    const listContainer = document.getElementById('songList');
    listContainer.innerHTML = '';

    if (!songsArray.length) {
        listContainer.innerHTML = '<p style="color: #b3b3b3; padding: 20px;">Belum ada lagu atau hasil search kosong.</p>';
        return;
    }

    songsArray.forEach((song, visibleIndex) => {
        const globalIndex = allSongs.findIndex(item => String(item.id) === String(song.id));
        const item = document.createElement('div');
        item.className = 'song-item';
        item.dataset.songId = String(song.id);

        const fileType = song.mime_type ? song.mime_type.replace('audio/', '').toUpperCase() : 'AUDIO';

        item.innerHTML = `
            <div class="song-title-group">
                <div class="song-icon">
                    <span class="default-icon">${visibleIndex + 1}</span>
                    <button class="play-btn-list" title="Putar"><i class="fas fa-play"></i></button>
                </div>
                <span class="song-name"></span>
            </div>
            <div class="col-action action-group">
                <span class="file-badge">${fileType}</span>
                <button class="delete-btn" title="Hapus lagu"><i class="fas fa-trash"></i></button>
            </div>
        `;

        item.querySelector('.song-name').innerText = song.name;

        item.onclick = () => playSongByIndex(globalIndex);
        item.querySelector('.play-btn-list').onclick = e => {
            e.stopPropagation();
            playSongByIndex(globalIndex);
        };
        item.querySelector('.delete-btn').onclick = async e => {
            e.stopPropagation();
            await deleteSong(song.id);
        };

        listContainer.appendChild(item);
    });

    highlightCurrentSong();
}

function highlightCurrentSong() {
    const activeId = currentSongIndex >= 0 ? allSongs[currentSongIndex]?.id : null;
    document.querySelectorAll('.song-item').forEach(item => {
        item.classList.toggle('is-playing', String(item.dataset.songId) === String(activeId));
    });
}

async function playSongByIndex(index) {
    if (index < 0 || index >= allSongs.length) return;

    const player = document.getElementById('audioPlayer');
    const playPauseBtn = document.getElementById('playPauseBtn');
    const currentSongName = document.getElementById('currentSongName');
    const currentSongSub = document.getElementById('currentSongSub');

    currentSongIndex = index;
    const song = allSongs[currentSongIndex];

    player.crossOrigin = 'anonymous';
    player.src = song.url;
    currentSongName.innerText = song.name;
    const typeLabel = song.mime_type ? song.mime_type.replace('audio/', '').toUpperCase() : 'AUDIO';
    currentSongSub.innerText = `Streaming ${typeLabel} dari Supabase`;
    player.load();

    await ensureAudioContextRunning();
    player.play().catch(err => console.log('Autoplay dicegah browser:', err));

    playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
    highlightCurrentSong();
}

async function togglePlayPause() {
    const player = document.getElementById('audioPlayer');
    const playPauseBtn = document.getElementById('playPauseBtn');

    if (!player.src) {
        if (allSongs.length) await playSongByIndex(0);
        return;
    }

    if (player.paused) {
        await ensureAudioContextRunning();
        player.play().catch(err => console.log('Gagal play:', err));
        playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
    } else {
        player.pause();
        playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
    }
}

function playNext() {
    if (!allSongs.length) return;
    const nextIndex = currentSongIndex >= 0 ? (currentSongIndex + 1) % allSongs.length : 0;
    playSongByIndex(nextIndex);
}

function playPrev() {
    const player = document.getElementById('audioPlayer');
    if (!allSongs.length) return;

    if (player.currentTime > 3) {
        player.currentTime = 0;
        return;
    }

    const prevIndex = currentSongIndex > 0 ? currentSongIndex - 1 : allSongs.length - 1;
    playSongByIndex(prevIndex);
}

function syncTimeline() {
    const player = document.getElementById('audioPlayer');
    const seekBar = document.getElementById('seekBar');
    const currentTime = document.getElementById('currentTime');
    const durationTime = document.getElementById('durationTime');

    if (!player.duration || !Number.isFinite(player.duration)) {
        seekBar.value = 0;
        currentTime.innerText = '0:00';
        durationTime.innerText = '0:00';
        return;
    }

    const progress = (player.currentTime / player.duration) * 100;
    seekBar.value = Number.isFinite(progress) ? progress : 0;
    currentTime.innerText = formatTime(player.currentTime);
    durationTime.innerText = formatTime(player.duration);
}

async function uploadSingleSong(file) {
    const safeName = sanitizeFileName(file.name);
    const filePath = `public/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;

    const { error: uploadError } = await supabaseClient.storage
        .from(SUPABASE_BUCKET)
        .upload(filePath, file, {
            cacheControl: '3600',
            upsert: false,
            contentType: file.type || 'audio/flac'
        });

    if (uploadError) throw uploadError;

    const { data: publicData } = supabaseClient.storage.from(SUPABASE_BUCKET).getPublicUrl(filePath);

    const { error: insertError } = await supabaseClient
        .from(SUPABASE_TABLE)
        .insert({
            name: file.name,
            path: filePath,
            url: publicData.publicUrl,
            mime_type: file.type || null,
            size_bytes: file.size
        });

    if (insertError) throw insertError;
    return filePath;
}

async function uploadSong() {
    const fileInput = document.getElementById('fileInput');
    const btn = document.getElementById('uploadBtn');
    const files = Array.from(fileInput.files || []);
    const audioFiles = files.filter(file => (file.type || '').startsWith('audio/'));

    if (!supabaseClient) {
        setUploadStatus('Config Supabase belum diisi.', '#ff6b6b');
        return;
    }

    if (!files.length) {
        setUploadStatus('Pilih file dulu.', '#ff6b6b');
        return;
    }

    if (!audioFiles.length) {
        setUploadStatus('Tidak ada file audio yang valid.', '#ff6b6b');
        return;
    }

    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading...';
    btn.disabled = true;

    let successCount = 0;
    let failCount = 0;
    const uploadedPaths = [];

    for (let i = 0; i < audioFiles.length; i += 1) {
        const file = audioFiles[i];
        setUploadStatus(`Upload ${i + 1}/${audioFiles.length}: ${file.name}`);
        try {
            const path = await uploadSingleSong(file);
            uploadedPaths.push(path);
            successCount += 1;
        } catch (error) {
            console.error('Upload gagal:', file.name, error);
            failCount += 1;
        }
    }

    const skippedCount = files.length - audioFiles.length;
    const color = failCount ? '#f59e0b' : '#1DB954';
    setUploadStatus(
        `Selesai. Berhasil: ${successCount}, gagal: ${failCount}, dilewati (bukan audio): ${skippedCount}.`,
        color
    );

    fileInput.value = '';
    setSelectedFilesText('Belum ada file dipilih.');

    await loadSongs();
    if (uploadedPaths.length) {
        const uploadedIndex = allSongs.findIndex(song => song.path === uploadedPaths[0]);
        if (uploadedIndex >= 0) playSongByIndex(uploadedIndex);
    }

    btn.innerHTML = '<i class="fas fa-upload"></i> Upload ke Supabase';
    btn.disabled = false;
}

async function deleteSong(songId) {
    const song = allSongs.find(item => String(item.id) === String(songId));
    if (!song) return;

    const isConfirmed = window.confirm(`Hapus "${song.name}" dari Supabase?`);
    if (!isConfirmed) return;

    setUploadStatus(`Menghapus: ${song.name}...`, '#f59e0b');

    try {
        if (song.path) {
            const { error: removeStorageError } = await supabaseClient
                .storage
                .from(SUPABASE_BUCKET)
                .remove([song.path]);

            if (removeStorageError && !String(removeStorageError.message || '').toLowerCase().includes('not found')) {
                throw removeStorageError;
            }
        }

        const { error: deleteRowError } = await supabaseClient
            .from(SUPABASE_TABLE)
            .delete()
            .eq('id', song.id);

        if (deleteRowError) throw deleteRowError;

        const wasCurrentSong = currentSongIndex >= 0 && String(allSongs[currentSongIndex]?.id) === String(song.id);
        await loadSongs();

        if (wasCurrentSong) {
            const player = document.getElementById('audioPlayer');
            player.pause();
            player.src = '';
            currentSongIndex = -1;
            document.getElementById('currentSongName').innerText = 'Belum ada lagu diputar';
            document.getElementById('currentSongSub').innerText = 'Public streaming via Supabase';
            document.getElementById('playPauseBtn').innerHTML = '<i class="fas fa-play"></i>';
            syncTimeline();
        } else if (currentSongIndex >= allSongs.length) {
            currentSongIndex = allSongs.length - 1;
            highlightCurrentSong();
        }

        setUploadStatus('Lagu berhasil dihapus.', '#1DB954');
    } catch (error) {
        console.error(error);
        setUploadStatus(`Gagal hapus: ${error.message || 'unknown error'}`, '#ff6b6b');
    }
}

function searchLagu() {
    const query = document.getElementById('searchInput').value.toLowerCase().trim();
    const filtered = allSongs.filter(song => song.name.toLowerCase().includes(query));
    renderSongs(filtered);
}

function switchMenu(menuItem, clickedEl) {
    const navItems = document.querySelectorAll('.nav-links li');
    const searchContainer = document.getElementById('searchContainer');
    const pageTitle = document.getElementById('pageTitle');

    navItems.forEach(item => item.classList.remove('active'));
    clickedEl.classList.add('active');

    if (menuItem === 'search') {
        searchContainer.style.display = 'flex';
        pageTitle.innerText = 'Search Results';
        document.getElementById('searchInput').focus();
        return;
    }

    searchContainer.style.display = 'none';
    pageTitle.innerText = menuItem === 'home' ? 'Your FLAC Collection' : 'Your Library';
    renderSongs(allSongs);
}
function initEqualizerBindings() {
    buildEQUI();
    loadEQStorage();
    syncEQControlsFromState();

    const presetSelect = document.getElementById('eqPresetSelect');
    const powerBtn = document.getElementById('eqPowerBtn');
    const saveBtn = document.getElementById('eqSaveBtn');
    const resetBtn = document.getElementById('eqResetBtn');
    const preamp = document.getElementById('eqPreamp');
    const eqClarity = document.getElementById('eqClarity');
    const eqAmbience = document.getElementById('eqAmbience');
    const eqSurround = document.getElementById('eqSurround');
    const eqDynamic = document.getElementById('eqDynamic');
    const eqBassBoost = document.getElementById('eqBassBoost');

    EQ_BANDS.forEach((_, index) => {
        const slider = document.getElementById(`eqBand-${index}`);
        slider.addEventListener('input', async () => {
            eqState.bands[index] = clamp(Number(slider.value), -12, 12);
            markPresetCustom();
            await ensureAudioContextRunning();
            applyEQStateToAudio();
            persistEQStorage();
        });
    });

    presetSelect.addEventListener('change', async () => {
        await ensureAudioContextRunning();
        applyPreset(presetSelect.value);
    });

    powerBtn.addEventListener('click', async () => {
        eqState.enabled = !eqState.enabled;
        await ensureAudioContextRunning();
        applyEQStateToAudio();
        persistEQStorage();
        setEQStatus(eqState.enabled ? 'Equalizer ON' : 'Equalizer OFF', eqState.enabled ? '#1DB954' : '#f59e0b');
    });

    preamp.addEventListener('input', async () => {
        eqState.preamp = clamp(Number(preamp.value), -12, 12);
        markPresetCustom();
        await ensureAudioContextRunning();
        applyEQStateToAudio();
        persistEQStorage();
    });

    eqClarity.addEventListener('input', async () => {
        eqState.effects.clarity = clamp(Number(eqClarity.value), 0, 100);
        markPresetCustom();
        updateEffectLabels();
        await ensureAudioContextRunning();
        applyEQStateToAudio();
        persistEQStorage();
    });

    eqAmbience.addEventListener('input', async () => {
        eqState.effects.ambience = clamp(Number(eqAmbience.value), 0, 100);
        markPresetCustom();
        updateEffectLabels();
        await ensureAudioContextRunning();
        applyEQStateToAudio();
        persistEQStorage();
    });

    eqSurround.addEventListener('input', async () => {
        eqState.effects.surround = clamp(Number(eqSurround.value), 0, 100);
        markPresetCustom();
        updateEffectLabels();
        await ensureAudioContextRunning();
        applyEQStateToAudio();
        persistEQStorage();
    });

    eqDynamic.addEventListener('input', async () => {
        eqState.effects.dynamic = clamp(Number(eqDynamic.value), 0, 100);
        markPresetCustom();
        updateEffectLabels();
        await ensureAudioContextRunning();
        applyEQStateToAudio();
        persistEQStorage();
    });

    eqBassBoost.addEventListener('input', async () => {
        eqState.effects.bassBoost = clamp(Number(eqBassBoost.value), 0, 100);
        markPresetCustom();
        updateEffectLabels();
        await ensureAudioContextRunning();
        applyEQStateToAudio();
        persistEQStorage();
    });

    saveBtn.addEventListener('click', () => {
        saveCurrentEQSetting();
    });

    resetBtn.addEventListener('click', () => {
        resetEQ();
    });

    document.addEventListener('pointerdown', () => {
        ensureAudioContextRunning();
    }, { once: true });
}

function initPlayerBindings() {
    const player = document.getElementById('audioPlayer');
    const playPauseBtn = document.getElementById('playPauseBtn');
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    const seekBar = document.getElementById('seekBar');
    const volumeBar = document.getElementById('volumeBar');
    const fileInput = document.getElementById('fileInput');

    playPauseBtn.addEventListener('click', togglePlayPause);
    prevBtn.addEventListener('click', playPrev);
    nextBtn.addEventListener('click', playNext);

    seekBar.addEventListener('input', () => {
        if (!player.duration || !Number.isFinite(player.duration)) return;
        player.currentTime = (seekBar.value / 100) * player.duration;
    });

    volumeBar.addEventListener('input', () => {
        player.volume = volumeBar.value / 100;
    });

    fileInput.addEventListener('change', () => {
        const files = Array.from(fileInput.files || []);
        if (!files.length) {
            setSelectedFilesText('Belum ada file dipilih.');
            return;
        }
        setSelectedFilesText(`${files.length} file dipilih.`);
    });

    player.addEventListener('timeupdate', syncTimeline);
    player.addEventListener('loadedmetadata', syncTimeline);
    player.addEventListener('play', () => {
        playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
    });
    player.addEventListener('pause', () => {
        playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
    });
    player.addEventListener('ended', playNext);
}

document.addEventListener('DOMContentLoaded', async () => {
    initPlayerBindings();
    initEqualizerBindings();
    const configured = initSupabase();

    if (!configured) {
        document.getElementById('songList').innerHTML = '<p style="color: #ff6b6b; padding: 20px;">Isi `SUPABASE_URL` dan `SUPABASE_ANON_KEY` di script.js.</p>';
        return;
    }

    await loadSongs();
});

