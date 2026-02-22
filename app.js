/* global supabase */

const SUPABASE_URL = 'https://gizslqqltboughqtzwla.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdpenNscXFsdGJvdWdocXR6d2xhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3MDg3NDcsImV4cCI6MjA4NzI4NDc0N30.CYjSPFKNBmYzugfaO-69RzRPNMq60Tp8uPXlHwg31mQ';
const client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const PLAY_ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7.05 3.606l13.49 7.788a.7.7 0 0 1 0 1.212L7.05 20.394A.7.7 0 0 1 6 19.788V4.212a.7.7 0 0 1 1.05-.606z"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5.7 3a.7.7 0 0 0-.7.7v16.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V3.7a.7.7 0 0 0-.7-.7H5.7zm10 0a.7.7 0 0 0-.7.7v16.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V3.7a.7.7 0 0 0-.7-.7h-2.6z"/></svg>';

const eqFrequencies = [101, 240, 397, 735, 1360, 2520, 4670, 11760, 16000];
const eqLabels = ['101 Hz', '240 Hz', '397 Hz', '735 Hz', '1.36 kHz', '2.52 kHz', '4.67 kHz', '11.76 kHz', '16.00 kHz'];
const LOOP_TITLES = ['Repeat off', 'Repeat all', 'Repeat one'];
const EQ_MIN_GAIN = -12;
const EQ_MAX_GAIN = 12;
const EQ_CHART_HEIGHT = 176;

const EQ_PRESETS = {
  flat: { gains: [0, 0, 0, 0, 0, 0, 0, 0, 0], effects: [0, 0, 0, 0, 0] },
  bass: { gains: [4, 3, 2, 1, 0, -1, -2, -2, -3], effects: [10, 10, 15, 25, 40] },
  clarity: { gains: [-2, -1, 0, 2, 3, 4, 5, 4, 3], effects: [45, 10, 25, 20, 10] }
};
const EQ_PRESET_LABELS = {
  custom: 'Custom',
  flat: 'Flat',
  bass: 'Bass Boost',
  clarity: 'High Clarity'
};
const EQ_USER_PRESETS_KEY = 'kp_eq_user_presets';

const state = {
  user: null,
  songs: [],
  favorites: new Set(),
  queue: loadQueue(),
  playlists: [],
  playlistTracks: new Map(),
  currentSong: null,
  currentContext: [],
  view: 'library',
  activePlaylistId: null,
  searchQuery: '',
  isShuffle: false,
  repeatMode: 0,
  pendingPlaylistSongId: null
};

const audio = new Audio();
audio.crossOrigin = 'anonymous';
audio.preload = 'metadata';

let savedEq = readStoredEq();
let userEqPresets = readUserEqPresets();
let audioCtx = null;
let analyser = null;
let dryGainNode = null;
let wetGainNode = null;
let bassNode = null;
let clarityNode = null;
let dynamicNode = null;
let ambienceDelayNode = null;
let ambienceGainNode = null;
let bands = [];
let histogramStarted = false;
let toastTimer = null;

const qs = (s) => document.querySelector(s);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const findSongById = (id) => state.songs.find((s) => s.id === id) || null;
const findPlaylistById = (id) => state.playlists.find((p) => p.id === id) || null;
const getPlaylistSongIds = (id) => state.playlistTracks.get(id) || [];
const getPlaylistSongs = (id) => getPlaylistSongIds(id).map(findSongById).filter(Boolean);

function cleanPath(p) {
  return typeof p === 'string' && p.startsWith('user-audio/') ? p.slice('user-audio/'.length) : (p || '');
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function escapeHtml(v) {
  return String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function showToast(message) {
  const toast = qs('#toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.add('hidden');
    toastTimer = null;
  }, 2600);
}

function loadQueue() {
  try {
    const parsed = JSON.parse(localStorage.getItem('kp_queue') || '[]');
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function persistQueue() {
  localStorage.setItem('kp_queue', JSON.stringify(state.queue));
}

function normalizeEqSettings(input) {
  const src = input && typeof input === 'object' ? input : {};
  const gains = Array.isArray(src.gains)
    ? src.gains.slice(0, eqFrequencies.length).map((v) => clamp(Number(v) || 0, EQ_MIN_GAIN, EQ_MAX_GAIN))
    : [];
  while (gains.length < eqFrequencies.length) gains.push(0);
  const effects = Array.isArray(src.effects) ? src.effects.slice(0, 5).map((v) => clamp(Number(v) || 0, 0, 100)) : [];
  while (effects.length < 5) effects.push(0);
  return { gains, effects, isOn: src.isOn !== false, preset: typeof src.preset === 'string' ? src.preset : 'flat' };
}

function readStoredEq() {
  try {
    return normalizeEqSettings(JSON.parse(localStorage.getItem('kp_eq_settings') || '{}'));
  } catch {
    return normalizeEqSettings({});
  }
}

function persistEq() {
  localStorage.setItem('kp_eq_settings', JSON.stringify(savedEq));
}

function readUserEqPresets() {
  try {
    const parsed = JSON.parse(localStorage.getItem(EQ_USER_PRESETS_KEY) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    const normalized = {};
    Object.entries(parsed).forEach(([id, rawPreset]) => {
      if (typeof id !== 'string' || !rawPreset || typeof rawPreset !== 'object') return;
      const name = String(rawPreset.name || '').trim();
      if (!name) return;
      const preset = normalizeEqSettings(rawPreset);
      normalized[id] = {
        name,
        gains: preset.gains,
        effects: preset.effects
      };
    });

    return normalized;
  } catch {
    return {};
  }
}

function persistUserEqPresets() {
  localStorage.setItem(EQ_USER_PRESETS_KEY, JSON.stringify(userEqPresets));
}

function slugifyPresetId(name) {
  const slug = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'preset';
}

function resolveUniquePresetId(baseId, keepId) {
  const seed = slugifyPresetId(baseId);
  let candidate = seed;
  let index = 2;

  while (
    candidate === 'custom'
    || Boolean(EQ_PRESETS[candidate])
    || (Boolean(userEqPresets[candidate]) && candidate !== keepId)
  ) {
    candidate = `${seed}-${index}`;
    index += 1;
  }

  return candidate;
}

function getEqPresetById(id) {
  if (!id || id === 'custom') return null;
  return EQ_PRESETS[id] || userEqPresets[id] || null;
}

function renderPresetOptions(selectedId) {
  const select = qs('#presetSelect');
  if (!select) return;

  const safeSelected = String(selectedId || savedEq.preset || 'custom');
  const userEntries = Object.entries(userEqPresets)
    .sort((a, b) => a[1].name.localeCompare(b[1].name));

  const defaultOptions = ['custom', 'flat', 'bass', 'clarity'].map((id) => (
    `<option value="${id}">${escapeHtml(EQ_PRESET_LABELS[id] || id)}</option>`
  ));

  const userOptions = userEntries.map(([id, preset]) => (
    `<option value="${escapeHtml(id)}">${escapeHtml(preset.name)}</option>`
  ));

  select.innerHTML = [
    ...defaultOptions,
    ...(userOptions.length ? ['<option value="__separator" disabled>────────</option>'] : []),
    ...userOptions
  ].join('');

  const isValidSelected = safeSelected === 'custom' || Boolean(getEqPresetById(safeSelected));
  select.value = isValidSelected ? safeSelected : 'custom';
}

function saveCurrentPreset() {
  const currentId = String(savedEq.preset || '');
  const currentUserPreset = userEqPresets[currentId] || null;
  const defaultName = currentUserPreset?.name || '';
  const rawName = window.prompt('Save preset as:', defaultName || 'My Preset');
  if (rawName === null) return;

  const name = rawName.trim();
  if (!name) {
    showToast('Preset name is empty.');
    return;
  }

  const shouldOverwriteCurrent = Boolean(
    currentUserPreset
    && currentUserPreset.name.toLowerCase() === name.toLowerCase()
  );

  const targetId = shouldOverwriteCurrent
    ? currentId
    : resolveUniquePresetId(name);

  userEqPresets[targetId] = {
    name,
    gains: savedEq.gains.slice(0, eqFrequencies.length),
    effects: savedEq.effects.slice(0, 5)
  };

  persistUserEqPresets();
  savedEq.preset = targetId;
  savedEq.isOn = true;
  persistEq();
  syncEqControls();
  showToast(`Preset "${name}" saved.`);
}

function setAuthView(isLoggedIn) {
  qs('#loginView')?.classList.toggle('hidden', isLoggedIn);
  qs('#mainApp')?.classList.toggle('hidden', !isLoggedIn);
}

function getSongTitle(song) {
  const title = String(song?.title || '').trim();
  return title || 'Untitled';
}

function getSongArtist(song) {
  const artist = String(song?.artist || '').trim();
  return artist || 'Unknown';
}

function removeMissingQueueItems() {
  const valid = new Set(state.songs.map((s) => s.id));
  const next = state.queue.filter((id) => valid.has(id));
  if (next.length !== state.queue.length) {
    state.queue = next;
    persistQueue();
  }
}

function prunePlaylistTrackCache() {
  const validSongs = new Set(state.songs.map((s) => s.id));
  const next = new Map();
  state.playlists.forEach((p) => {
    next.set(p.id, getPlaylistSongIds(p.id).filter((songId) => validSongs.has(songId)));
  });
  state.playlistTracks = next;
}

function ensureViewIntegrity() {
  if (state.view === 'playlist' && !findPlaylistById(state.activePlaylistId)) {
    state.view = 'library';
    state.activePlaylistId = null;
  }
}

function getViewSongs() {
  let base = [];
  if (state.view === 'playlist' && state.activePlaylistId) {
    base = getPlaylistSongs(state.activePlaylistId);
  } else if (state.view === 'liked') {
    base = state.songs.filter((s) => state.favorites.has(s.id));
  } else if (state.view === 'queue') {
    base = state.queue.map(findSongById).filter(Boolean);
  } else {
    base = state.songs.slice();
  }

  const q = state.searchQuery.trim().toLowerCase();
  if (!q) return base;

  return base.filter((song) => {
    const t = String(song.title || '').toLowerCase();
    const a = String(song.artist || '').toLowerCase();
    const al = String(song.album || '').toLowerCase();
    return t.includes(q) || a.includes(q) || al.includes(q);
  });
}

function getViewHeaderMeta() {
  if (state.view === 'playlist' && state.activePlaylistId) {
    const p = findPlaylistById(state.activePlaylistId);
    const count = getPlaylistSongIds(state.activePlaylistId).length;
    return { title: p?.name || 'Playlist', sub: `${count} track${count === 1 ? '' : 's'} in your private mix` };
  }
  if (state.view === 'liked') return { title: 'Liked Songs', sub: 'Your saved favorites' };
  if (state.view === 'queue') return { title: 'Queue', sub: 'Next up in your session' };
  return { title: 'Home', sub: 'All songs from your private FLAC library' };
}

function updateNavSelection() {
  document.querySelectorAll('.nav-item[data-view]').forEach((btn) => {
    btn.classList.toggle('active', state.view !== 'playlist' && btn.dataset.view === state.view);
  });
  document.querySelectorAll('.playlist-item').forEach((btn) => {
    btn.classList.toggle('active', state.view === 'playlist' && btn.dataset.id === state.activePlaylistId);
  });
}

function setPlayButton(isPlaying) {
  const playBtn = qs('#playBtn');
  if (playBtn) playBtn.innerHTML = isPlaying ? PAUSE_ICON : PLAY_ICON;
}

function setShuffleButtonState() {
  qs('#shuffleBtn')?.classList.toggle('active', state.isShuffle);
}

function setLoopButtonState() {
  const btn = qs('#loopBtn');
  if (!btn) return;
  btn.classList.toggle('active', state.repeatMode > 0);
  btn.classList.toggle('mode-one', state.repeatMode === 2);
  btn.title = LOOP_TITLES[state.repeatMode];
}

function renderPlaylistList() {
  const list = qs('#playlistList');
  if (!list) return;

  if (!state.playlists.length) {
    list.innerHTML = '<div class="playlist-empty">No playlist yet. Click + New.</div>';
    return;
  }

  list.innerHTML = state.playlists.map((playlist) => {
    const count = getPlaylistSongIds(playlist.id).length;
    return `
      <div class="playlist-row">
        <button class="playlist-item" data-action="open-playlist" data-id="${escapeHtml(playlist.id)}">
          <span class="playlist-name">${escapeHtml(playlist.name)}</span>
          <span class="playlist-meta">${count} track${count === 1 ? '' : 's'}</span>
        </button>
        <button class="playlist-trash" data-action="delete-playlist" data-id="${escapeHtml(playlist.id)}" title="Delete playlist">
          <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm5 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path fill-rule="evenodd" d="M14 3a1 1 0 0 1-1 1h-1v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4H3a1 1 0 1 1 0-2h3.5a1 1 0 0 1 .98-.804h1.04A1 1 0 0 1 9.5 2H13a1 1 0 0 1 1 1zM5 4v9a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V4H5z"/></svg>
        </button>
      </div>`;
  }).join('');
}

function renderEmptyState() {
  if (state.view === 'playlist') return '<div class="empty-view">This playlist is empty. Add songs from your library.</div>';
  if (state.view === 'liked') return '<div class="empty-view">No liked songs yet.</div>';
  if (state.view === 'queue') return '<div class="empty-view">Queue is empty.</div>';
  return '<div class="empty-view">No songs in your library yet. Upload audio first.</div>';
}

function renderSongRow(song, index) {
  const isActive = state.currentSong?.id === song.id;
  const isLiked = state.favorites.has(song.id);
  const isQueued = state.queue.includes(song.id);
  const inActivePlaylist = state.view === 'playlist' && state.activePlaylistId
    ? getPlaylistSongIds(state.activePlaylistId).includes(song.id)
    : false;

  const playlistButton = inActivePlaylist
    ? `<button class="icon-btn playlist-btn" data-action="remove-from-playlist" data-id="${escapeHtml(song.id)}" data-playlist-id="${escapeHtml(state.activePlaylistId || '')}" title="Remove from this playlist"><svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M3 8a.75.75 0 0 1 .75-.75h8.5a.75.75 0 0 1 0 1.5h-8.5A.75.75 0 0 1 3 8z"/></svg></button>`
    : `<button class="icon-btn playlist-btn" data-action="open-playlist-picker" data-id="${escapeHtml(song.id)}" title="Add to playlist"><svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 1.5a.75.75 0 0 1 .75.75v5h5a.75.75 0 0 1 0 1.5h-5v5a.75.75 0 0 1-1.5 0v-5h-5a.75.75 0 0 1 0-1.5h5v-5A.75.75 0 0 1 8 1.5z"/></svg></button>`;

  return `
    <div class="row ${isActive ? 'track-active' : ''}" data-id="${escapeHtml(song.id)}">
      <div class="row-num"><span>${index + 1}</span></div>
      <div class="track-info-cell">
        <div class="track-name">${escapeHtml(getSongTitle(song))}</div>
        <div class="track-meta">${escapeHtml(getSongArtist(song))}</div>
      </div>
      <div class="track-meta truncate">${escapeHtml(song.album || '-')}</div>
      <div class="duration-text">${formatTime(Number(song.duration_seconds))}</div>
      <div class="actions-cell">
        <button class="icon-btn ${isLiked ? 'liked' : ''}" data-action="toggle-like" data-id="${escapeHtml(song.id)}" title="${isLiked ? 'Remove like' : 'Like song'}"><svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 1.314C3.562-3.248-7.534 4.735 8 15c15.534-10.265 4.438-18.248 0-13.686z"/></svg></button>
        <button class="icon-btn ${isQueued ? 'in-queue' : ''}" data-action="toggle-queue" data-id="${escapeHtml(song.id)}" title="${isQueued ? 'Remove from queue' : 'Add to queue'}"><svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M2.5 5a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5zm0 3a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5zm0 3a.5.5 0 0 1 .5-.5h4a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5zm8.5-1.25a.75.75 0 0 1 .75.75v1h1a.75.75 0 0 1 0 1.5h-1v1a.75.75 0 0 1-1.5 0v-1h-1a.75.75 0 0 1 0-1.5h1v-1a.75.75 0 0 1 .75-.75z"/></svg></button>
        ${playlistButton}
        <button class="icon-btn delete-btn" data-action="delete-song" data-id="${escapeHtml(song.id)}" title="Delete from library"><svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm5 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path fill-rule="evenodd" d="M14 3a1 1 0 0 1-1 1h-1v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4H3a1 1 0 1 1 0-2h3.5a1 1 0 0 1 .98-.804h1.04A1 1 0 0 1 9.5 2H13a1 1 0 0 1 1 1zM5 4v9a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V4H5z"/></svg></button>
      </div>
    </div>`;
}

function render() {
  ensureViewIntegrity();
  const viewTitle = qs('#viewTitle');
  const viewSub = qs('#viewSub');
  const viewContent = qs('#viewContent');
  if (!viewTitle || !viewContent) return;

  renderPlaylistList();
  updateNavSelection();

  const meta = getViewHeaderMeta();
  viewTitle.textContent = meta.title;
  if (viewSub) viewSub.textContent = meta.sub;

  const songs = getViewSongs();
  state.currentContext = songs;

  viewContent.innerHTML = songs.length ? songs.map(renderSongRow).join('') : renderEmptyState();
}

function initAudioDSP() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const source = audioCtx.createMediaElementSource(audio);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;

  dryGainNode = audioCtx.createGain();
  wetGainNode = audioCtx.createGain();
  bassNode = audioCtx.createBiquadFilter();
  clarityNode = audioCtx.createBiquadFilter();
  dynamicNode = audioCtx.createDynamicsCompressor();
  ambienceDelayNode = audioCtx.createDelay();
  ambienceGainNode = audioCtx.createGain();
  const masterNode = audioCtx.createGain();

  bassNode.type = 'lowshelf';
  bassNode.frequency.value = 80;
  clarityNode.type = 'highshelf';
  clarityNode.frequency.value = 5000;
  ambienceDelayNode.delayTime.value = 0.05;

  bands = eqFrequencies.map((freq, i) => {
    const f = audioCtx.createBiquadFilter();
    f.type = 'peaking';
    f.Q.value = 1.41;
    f.frequency.value = freq;
    f.gain.value = savedEq.gains[i];
    return f;
  });

  source.connect(dryGainNode);
  dryGainNode.connect(analyser);

  source.connect(wetGainNode);
  wetGainNode.connect(bassNode);
  bassNode.connect(clarityNode);
  clarityNode.connect(dynamicNode);

  let tailNode = dynamicNode;
  bands.forEach((band) => {
    tailNode.connect(band);
    tailNode = band;
  });

  tailNode.connect(masterNode);
  tailNode.connect(ambienceDelayNode);
  ambienceDelayNode.connect(ambienceGainNode);
  ambienceGainNode.connect(masterNode);
  masterNode.connect(analyser);
  analyser.connect(audioCtx.destination);

  applyDSP();
  if (!histogramStarted) {
    histogramStarted = true;
    drawHistogram();
  }
}

function applyDSP() {
  if (!audioCtx || !dryGainNode || !wetGainNode || !clarityNode || !ambienceGainNode || !ambienceDelayNode || !dynamicNode || !bassNode) return;
  dryGainNode.gain.value = savedEq.isOn ? 0 : 1;
  wetGainNode.gain.value = savedEq.isOn ? 1 : 0;
  clarityNode.gain.value = (savedEq.effects[0] / 100) * 15;
  ambienceGainNode.gain.value = (savedEq.effects[1] / 100) * 0.35;
  ambienceDelayNode.delayTime.value = 0.01 + (savedEq.effects[2] / 100) * 0.09;
  dynamicNode.ratio.value = 1 + (savedEq.effects[3] / 100) * 10;
  bassNode.gain.value = (savedEq.effects[4] / 100) * 15;
  bands.forEach((band, i) => {
    band.gain.value = savedEq.gains[i];
  });
}

function drawHistogram() {
  const modal = qs('#eqModal');
  const canvas = qs('#histogram');
  if (!analyser || !modal || !canvas || modal.classList.contains('hidden')) return;
  requestAnimationFrame(drawHistogram);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  if (canvas.clientWidth > 0 && canvas.width !== canvas.clientWidth) canvas.width = canvas.clientWidth;

  const data = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(data);

  ctx.fillStyle = '#050505';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const bw = (canvas.width / data.length) * 2.6;
  let x = 0;
  for (let i = 0; i < data.length; i += 1) {
    const bh = data[i] / 2;
    ctx.fillStyle = savedEq.isOn ? `rgb(${bh + 90}, 38, 74)` : '#333';
    ctx.fillRect(x, canvas.height - bh, bw, bh);
    x += bw + 1;
  }
}

function formatEqValue(gain) {
  const rounded = Math.round(gain);
  if (rounded > 0) return `+${rounded}`;
  if (rounded === 0) return '+0';
  return String(rounded);
}

function formatFrequencyLabel(label) {
  return String(label || '');
}

function gainToPercent(gain) {
  const normalized = clamp((clamp(gain, EQ_MIN_GAIN, EQ_MAX_GAIN) - EQ_MIN_GAIN) / (EQ_MAX_GAIN - EQ_MIN_GAIN), 0, 1);
  return (1 - normalized) * 100;
}

function gainToKnobPercent(gain) {
  return clamp(((clamp(gain, EQ_MIN_GAIN, EQ_MAX_GAIN) - EQ_MIN_GAIN) / (EQ_MAX_GAIN - EQ_MIN_GAIN)) * 100, 0, 100);
}

function updateEqCurvePath(container) {
  if (!container) return;
  const linePath = container.querySelector('.eq-line-path');
  const fillPath = container.querySelector('.eq-fill-path');
  if (!linePath || !fillPath) return;

  const width = 1000;
  const points = savedEq.gains.map((gain, idx) => {
    const x = (idx / (eqFrequencies.length - 1)) * width;
    const y = (gainToPercent(gain) / 100) * EQ_CHART_HEIGHT;
    return { x, y };
  });

  if (!points.length) return;

  let lineD = '';
  if (points.length === 1) {
    lineD = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  } else if (points.length === 2) {
    lineD = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)} L ${points[1].x.toFixed(2)} ${points[1].y.toFixed(2)}`;
  } else {
    lineD = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
    for (let i = 1; i < points.length - 1; i += 1) {
      const cpX = points[i].x;
      const cpY = points[i].y;
      const endX = (points[i].x + points[i + 1].x) / 2;
      const endY = (points[i].y + points[i + 1].y) / 2;
      lineD += ` Q ${cpX.toFixed(2)} ${cpY.toFixed(2)} ${endX.toFixed(2)} ${endY.toFixed(2)}`;
    }
    const last = points[points.length - 1];
    lineD += ` T ${last.x.toFixed(2)} ${last.y.toFixed(2)}`;
  }

  const fillD = `${lineD} L ${width} ${EQ_CHART_HEIGHT} L 0 ${EQ_CHART_HEIGHT} Z`;
  linePath.setAttribute('d', lineD);
  fillPath.setAttribute('d', fillD);
}

function renderEq() {
  const cont = qs('#eqSlidersContainer');
  if (!cont) return;

  const bandsMarkup = eqFrequencies.map((_, i) => {
    const gain = clamp(Number(savedEq.gains[i]) || 0, EQ_MIN_GAIN, EQ_MAX_GAIN);
    const gainPercent = gainToPercent(gain).toFixed(2);
    const knobPercent = gainToKnobPercent(gain);

    return `
      <div class="eq-band">
        <div class="eq-val">${formatEqValue(gain)}</div>
        <div class="eq-track-zone">
          <div class="eq-vline"></div>
          <span class="eq-dot" style="--gain-pct:${gainPercent}%"></span>
          <input type="range" class="eq-range" min="${EQ_MIN_GAIN}" max="${EQ_MAX_GAIN}" step="0.1" value="${gain}" data-idx="${i}">
        </div>
        <div class="eq-hz">${escapeHtml(formatFrequencyLabel(eqLabels[i]))}</div>
        <div class="eq-knob" style="--knob-pct:${knobPercent.toFixed(2)}"><span></span></div>
      </div>`;
  }).join('');

  cont.innerHTML = `
    <div class="eq-graph-shell">
      <svg class="eq-curve-svg" viewBox="0 0 1000 ${EQ_CHART_HEIGHT}" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="eqFillGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="rgba(240,51,85,0.55)"></stop>
            <stop offset="100%" stop-color="rgba(240,51,85,0.02)"></stop>
          </linearGradient>
        </defs>
        <path class="eq-fill-path" fill="url(#eqFillGradient)"></path>
        <path class="eq-line-path" fill="none"></path>
      </svg>
      <div class="eq-bands">${bandsMarkup}</div>
    </div>`;

  cont.querySelectorAll('.eq-range').forEach((input) => {
    input.addEventListener('input', (e) => {
      const idx = Number(e.target.dataset.idx);
      const nextGain = clamp(Number(e.target.value), EQ_MIN_GAIN, EQ_MAX_GAIN);
      savedEq.gains[idx] = nextGain;
      savedEq.preset = 'custom';
      persistEq();
      applyDSP();

      const band = e.target.closest('.eq-band');
      const val = band?.querySelector('.eq-val');
      const dot = band?.querySelector('.eq-dot');
      const knob = band?.querySelector('.eq-knob');

      if (val) val.textContent = formatEqValue(nextGain);
      if (dot) dot.style.setProperty('--gain-pct', `${gainToPercent(nextGain).toFixed(2)}%`);
      if (knob) knob.style.setProperty('--knob-pct', `${gainToKnobPercent(nextGain).toFixed(2)}`);

      const preset = qs('#presetSelect');
      if (preset) preset.value = 'custom';
      updateEqCurvePath(cont);
    });
  });

  updateEqCurvePath(cont);
}

function syncEqControls() {
  const powerBtn = qs('#eqToggleBtn');
  if (powerBtn) {
    powerBtn.classList.toggle('off', !savedEq.isOn);
    powerBtn.setAttribute('aria-pressed', savedEq.isOn ? 'true' : 'false');
    powerBtn.title = savedEq.isOn ? 'FxSound ON' : 'FxSound OFF';
    const stateLabel = powerBtn.querySelector('.fx-power-state');
    if (stateLabel) stateLabel.textContent = savedEq.isOn ? 'ON' : 'OFF';
  }

  renderPresetOptions(savedEq.preset);

  [['#fxClarity', 0], ['#fxAmbience', 1], ['#fxSurround', 2], ['#fxDynamic', 3], ['#fxBass', 4]].forEach(([sel, i]) => {
    const input = qs(sel);
    if (!input) return;
    input.value = String(savedEq.effects[i]);
  });

  renderEq();
  applyDSP();
}

function applyPreset(name) {
  if (!name || name === 'custom') {
    savedEq.preset = 'custom';
    persistEq();
    syncEqControls();
    return;
  }

  const preset = getEqPresetById(name);
  if (!preset) {
    savedEq.preset = 'custom';
    persistEq();
    syncEqControls();
    return;
  }

  savedEq.gains = preset.gains.slice(0, eqFrequencies.length);
  while (savedEq.gains.length < eqFrequencies.length) savedEq.gains.push(0);
  savedEq.effects = preset.effects.slice(0, 5);
  while (savedEq.effects.length < 5) savedEq.effects.push(0);
  savedEq.preset = name;
  savedEq.isOn = true;
  persistEq();
  syncEqControls();
}
function renderPlaylistPicker() {
  const list = qs('#playlistPickerList');
  if (!list) return;

  if (!state.playlists.length) {
    list.innerHTML = '<div class="playlist-picker-empty">No playlist yet. Create one first.</div>';
    return;
  }

  list.innerHTML = state.playlists.map((playlist) => {
    const count = getPlaylistSongIds(playlist.id).length;
    return `<button class="picker-playlist-btn" data-action="pick-playlist" data-id="${escapeHtml(playlist.id)}"><span>${escapeHtml(playlist.name)}</span><small>${count} track${count === 1 ? '' : 's'}</small></button>`;
  }).join('');
}

function openPlaylistPicker(songId) {
  if (!songId) return;
  if (!state.playlists.length) {
    showToast('Create a playlist first.');
    return;
  }
  state.pendingPlaylistSongId = songId;
  renderPlaylistPicker();
  qs('#playlistPickerModal')?.classList.remove('hidden');
}

function closePlaylistPicker() {
  state.pendingPlaylistSongId = null;
  qs('#playlistPickerModal')?.classList.add('hidden');
}

async function getSignedSongUrl(song) {
  const path = cleanPath(song?.audio_path || '');
  if (!path) throw new Error('Song path is empty.');
  const { data, error } = await client.storage.from('user-audio').createSignedUrl(path, 7200);
  if (error) throw error;
  if (!data?.signedUrl) throw new Error('Failed to create signed URL.');
  return data.signedUrl;
}

async function markRecentlyPlayed(songId) {
  if (!state.user || !songId) return;
  const source = state.view === 'playlist' && state.activePlaylistId ? `playlist:${state.activePlaylistId}` : state.view;
  const { error } = await client.from('recently_played').insert({ user_id: state.user.id, song_id: songId, source });
  if (error) console.warn('recently_played insert failed', error.message);
}

function getPlaybackContext() {
  const valid = new Set(state.songs.map((s) => s.id));
  const context = (state.currentContext || []).filter((song) => song && valid.has(song.id));
  return context.length ? context : getViewSongs();
}

async function playSong(song, context) {
  if (!song) return;
  initAudioDSP();
  if (audioCtx?.state === 'suspended') await audioCtx.resume();

  const playbackContext = Array.isArray(context) && context.length ? context : getViewSongs();
  state.currentSong = song;
  state.currentContext = playbackContext;

  const nowTitle = qs('#nowTitle');
  const nowSub = qs('#nowSub');
  if (nowTitle) nowTitle.textContent = getSongTitle(song);
  if (nowSub) nowSub.textContent = getSongArtist(song);

  try {
    const signedUrl = await getSignedSongUrl(song);
    if (audio.src !== signedUrl) audio.src = signedUrl;
    await audio.play();
    setPlayButton(true);
    render();
    markRecentlyPlayed(song.id);
  } catch (error) {
    console.error(error);
    showToast(`Playback failed: ${error.message || 'unknown error'}`);
  }
}

async function playRelative(step) {
  const context = getPlaybackContext();
  if (!context.length) return;

  if (!state.currentSong) {
    await playSong(context[0], context);
    return;
  }

  const currentIndex = context.findIndex((song) => song.id === state.currentSong.id);
  let nextIndex = currentIndex;

  if (state.isShuffle && context.length > 1) {
    do {
      nextIndex = Math.floor(Math.random() * context.length);
    } while (nextIndex === currentIndex);
  } else {
    nextIndex = currentIndex + step;
    if (nextIndex < 0 || nextIndex >= context.length) {
      if (state.repeatMode === 1) {
        nextIndex = nextIndex < 0 ? context.length - 1 : 0;
      } else {
        audio.pause();
        setPlayButton(false);
        return;
      }
    }
  }

  await playSong(context[nextIndex], context);
}

async function togglePlayPause() {
  if (!state.currentSong) {
    const songs = getViewSongs();
    if (!songs.length) {
      showToast('No songs to play.');
      return;
    }
    await playSong(songs[0], songs);
    return;
  }

  if (audio.paused) {
    try {
      if (audioCtx?.state === 'suspended') await audioCtx.resume();
      await audio.play();
    } catch (error) {
      console.error(error);
      showToast('Unable to resume playback.');
    }
  } else {
    audio.pause();
  }
}

async function handlePrev() {
  if (audio.currentTime > 5) {
    audio.currentTime = 0;
    return;
  }
  await playRelative(-1);
}

async function toggleFavorite(songId) {
  if (!state.user || !songId) return;

  if (state.favorites.has(songId)) {
    const { error } = await client.from('favorites').delete().eq('user_id', state.user.id).eq('song_id', songId);
    if (error) {
      console.error(error);
      showToast('Failed to remove favorite.');
      return;
    }
    state.favorites.delete(songId);
    showToast('Removed from favorites.');
  } else {
    const { error } = await client.from('favorites').insert({ user_id: state.user.id, song_id: songId });
    if (error) {
      console.error(error);
      showToast('Failed to add favorite.');
      return;
    }
    state.favorites.add(songId);
    showToast('Added to favorites.');
  }

  render();
}

function toggleQueue(songId) {
  if (!songId) return;
  const index = state.queue.indexOf(songId);
  if (index >= 0) {
    state.queue.splice(index, 1);
    showToast('Removed from queue.');
  } else {
    state.queue.push(songId);
    showToast('Added to queue.');
  }
  persistQueue();
  render();
}

async function fetchSongs() {
  if (!state.user) {
    state.songs = [];
    return;
  }

  const { data, error } = await client.from('songs').select('*').eq('owner_id', state.user.id).order('created_at', { ascending: false });
  if (error) {
    console.error(error);
    showToast('Failed to load songs.');
    state.songs = [];
    return;
  }

  state.songs = data || [];
  removeMissingQueueItems();
}

async function fetchFavorites() {
  if (!state.user) {
    state.favorites = new Set();
    return;
  }

  const { data, error } = await client.from('favorites').select('song_id').eq('user_id', state.user.id);
  if (error) {
    console.error(error);
    showToast('Failed to load favorites.');
    state.favorites = new Set();
    return;
  }

  state.favorites = new Set((data || []).map((row) => row.song_id));
}

async function fetchPlaylists() {
  if (!state.user) {
    state.playlists = [];
    return;
  }

  const { data, error } = await client.from('playlists').select('id,name,created_at').eq('owner_id', state.user.id).order('created_at', { ascending: false });
  if (error) {
    console.error(error);
    showToast('Failed to load playlists.');
    state.playlists = [];
    return;
  }

  state.playlists = data || [];
}

async function fetchPlaylistTracks() {
  if (!state.user || !state.playlists.length) {
    state.playlistTracks = new Map();
    return;
  }

  const playlistIds = state.playlists.map((p) => p.id);
  const { data, error } = await client.from('playlist_tracks').select('playlist_id,song_id,position').in('playlist_id', playlistIds).order('position', { ascending: true });
  if (error) {
    console.error(error);
    showToast('Failed to load playlist tracks.');
    state.playlistTracks = new Map();
    return;
  }

  const grouped = new Map();
  state.playlists.forEach((p) => grouped.set(p.id, []));
  (data || []).forEach((row) => {
    const items = grouped.get(row.playlist_id);
    if (items) items.push({ songId: row.song_id, position: Number.isFinite(row.position) ? row.position : 0 });
  });

  const normalized = new Map();
  grouped.forEach((items, pid) => {
    normalized.set(pid, items.sort((a, b) => a.position - b.position).map((x) => x.songId));
  });

  state.playlistTracks = normalized;
  prunePlaylistTrackCache();
}

async function createPlaylistFromPrompt() {
  if (!state.user) return;
  const name = window.prompt('Playlist name:');
  if (!name) return;
  const trimmed = name.trim();
  if (!trimmed) {
    showToast('Playlist name is empty.');
    return;
  }

  const { data, error } = await client.from('playlists').insert({ owner_id: state.user.id, name: trimmed }).select('id,name,created_at').single();
  if (error) {
    console.error(error);
    showToast(`Failed to create playlist: ${error.message}`);
    return;
  }

  if (data) {
    state.playlists.unshift(data);
    state.playlistTracks.set(data.id, []);
    state.view = 'playlist';
    state.activePlaylistId = data.id;
    showToast('Playlist created.');
    render();
  }
}

async function deletePlaylist(playlistId) {
  if (!playlistId || !state.user) return;
  const playlist = findPlaylistById(playlistId);
  if (!playlist) return;

  const confirmed = window.confirm(`Delete playlist "${playlist.name}"?`);
  if (!confirmed) return;

  const { error } = await client.from('playlists').delete().eq('id', playlistId).eq('owner_id', state.user.id);
  if (error) {
    console.error(error);
    showToast(`Failed to delete playlist: ${error.message}`);
    return;
  }

  state.playlists = state.playlists.filter((x) => x.id !== playlistId);
  state.playlistTracks.delete(playlistId);
  if (state.activePlaylistId === playlistId) {
    state.activePlaylistId = null;
    state.view = 'library';
  }

  showToast('Playlist deleted.');
  render();
}

async function addSongToPlaylist(songId, playlistId) {
  if (!state.user || !songId || !playlistId) return;
  const playlist = findPlaylistById(playlistId);
  if (!playlist) {
    showToast('Playlist not found.');
    return;
  }

  const current = getPlaylistSongIds(playlistId);
  if (current.includes(songId)) {
    showToast('Song already in that playlist.');
    return;
  }

  const { error } = await client.from('playlist_tracks').insert({ playlist_id: playlistId, song_id: songId, position: current.length });
  if (error) {
    console.error(error);
    showToast(`Failed to add song: ${error.message}`);
    return;
  }

  state.playlistTracks.set(playlistId, [...current, songId]);
  showToast(`Added to ${playlist.name}.`);
  render();
}

async function removeSongFromPlaylist(songId, playlistId) {
  if (!state.user || !songId || !playlistId) return;

  const { error } = await client.from('playlist_tracks').delete().eq('playlist_id', playlistId).eq('song_id', songId);
  if (error) {
    console.error(error);
    showToast(`Failed to remove song: ${error.message}`);
    return;
  }

  state.playlistTracks.set(playlistId, getPlaylistSongIds(playlistId).filter((id) => id !== songId));
  showToast('Removed from playlist.');
  render();
}

function sanitizeFileName(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function parseFileMetadata(fileName) {
  const base = String(fileName || '').replace(/\.[^/.]+$/, '').trim();
  if (!base) return { title: 'Untitled', artist: 'Unknown' };
  const parts = base.split(' - ');
  if (parts.length > 1) {
    const artist = parts.shift().trim() || 'Unknown';
    const title = parts.join(' - ').trim() || base;
    return { title, artist };
  }
  return { title: base, artist: 'Unknown' };
}

function probeDurationSeconds(file) {
  return new Promise((resolve) => {
    const probe = document.createElement('audio');
    const objectUrl = URL.createObjectURL(file);

    const cleanup = () => {
      URL.revokeObjectURL(objectUrl);
      probe.removeAttribute('src');
      probe.load();
    };

    probe.preload = 'metadata';
    probe.onloadedmetadata = () => {
      const duration = Number.isFinite(probe.duration) ? Math.round(probe.duration) : null;
      cleanup();
      resolve(duration);
    };

    probe.onerror = () => {
      cleanup();
      resolve(null);
    };

    probe.src = objectUrl;
  });
}
async function uploadFiles(files) {
  if (!state.user) {
    showToast('Please log in first.');
    return;
  }
  if (!files.length) return;

  let successCount = 0;
  let failedCount = 0;

  for (const file of files) {
    const isAudio = file.type.startsWith('audio/') || /\.(flac|mp3|wav|m4a|aac|ogg|opus)$/i.test(file.name);
    if (!isAudio) {
      failedCount += 1;
      continue;
    }

    const songId = crypto.randomUUID();
    const safeName = sanitizeFileName(file.name);
    const objectPath = `${state.user.id}/${songId}-${safeName}`;

    const { error: uploadError } = await client.storage.from('user-audio').upload(objectPath, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || 'application/octet-stream'
    });

    if (uploadError) {
      console.error(uploadError);
      failedCount += 1;
      continue;
    }

    const meta = parseFileMetadata(file.name);
    const duration = await probeDurationSeconds(file);

    const { error: insertError } = await client.from('songs').insert({
      id: songId,
      owner_id: state.user.id,
      title: meta.title,
      artist: meta.artist,
      album: null,
      duration_seconds: duration,
      mime_type: file.type || null,
      size_bytes: file.size,
      audio_path: `user-audio/${objectPath}`
    });

    if (insertError) {
      console.error(insertError);
      await client.storage.from('user-audio').remove([objectPath]);
      failedCount += 1;
      continue;
    }

    successCount += 1;
  }

  if (successCount > 0) {
    await fetchSongs();
    prunePlaylistTrackCache();
    render();
  }

  showToast(`${successCount} uploaded, ${failedCount} failed.`);
}

async function deleteSongFromLibrary(songId) {
  if (!state.user || !songId) return;
  const song = findSongById(songId);
  if (!song) return;

  const ok = window.confirm(`Delete "${getSongTitle(song)}" from library?`);
  if (!ok) return;

  let warning = false;
  const refs = await Promise.all([
    client.from('favorites').delete().eq('song_id', songId),
    client.from('playlist_tracks').delete().eq('song_id', songId),
    client.from('recently_played').delete().eq('song_id', songId)
  ]);

  refs.forEach((r) => {
    if (r.error) {
      warning = true;
      console.warn(r.error);
    }
  });

  const { error: songError } = await client.from('songs').delete().eq('id', songId).eq('owner_id', state.user.id);
  if (songError) {
    console.error(songError);
    showToast(`Failed to delete song: ${songError.message}`);
    return;
  }

  const storagePath = cleanPath(song.audio_path);
  if (storagePath) {
    const { error: storageError } = await client.storage.from('user-audio').remove([storagePath]);
    if (storageError) {
      warning = true;
      console.warn(storageError);
    }
  }

  state.songs = state.songs.filter((x) => x.id !== songId);
  state.favorites.delete(songId);
  state.queue = state.queue.filter((id) => id !== songId);
  persistQueue();

  state.playlistTracks.forEach((ids, pid) => {
    state.playlistTracks.set(pid, ids.filter((id) => id !== songId));
  });

  if (state.currentSong?.id === songId) {
    audio.pause();
    audio.src = '';
    state.currentSong = null;

    if (qs('#nowTitle')) qs('#nowTitle').textContent = 'No song playing';
    if (qs('#nowSub')) qs('#nowSub').textContent = '-';
    if (qs('#timeCurrent')) qs('#timeCurrent').textContent = '0:00';
    if (qs('#timeTotal')) qs('#timeTotal').textContent = '0:00';
    if (qs('#progressBar')) qs('#progressBar').value = '0';

    setPlayButton(false);
  }

  render();
  showToast(warning ? 'Song deleted with minor cleanup warning.' : 'Song deleted from library.');
}

function bindAudioEvents() {
  audio.ontimeupdate = () => {
    const bar = qs('#progressBar');
    const cur = qs('#timeCurrent');
    const total = qs('#timeTotal');
    if (!bar || !cur || !total) return;

    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      bar.value = String((audio.currentTime / audio.duration) * 100);
      cur.textContent = formatTime(audio.currentTime);
      total.textContent = formatTime(audio.duration);
    }
  };

  audio.onplay = () => {
    setPlayButton(true);
    render();
  };

  audio.onpause = () => {
    setPlayButton(false);
    render();
  };

  audio.onended = async () => {
    if (state.repeatMode === 2 && state.currentSong) {
      await playSong(state.currentSong, getPlaybackContext());
      return;
    }
    await playRelative(1);
  };

  audio.onerror = () => showToast('Audio playback error.');
}

function bindUiEvents() {
  const loginBtn = qs('#loginBtn');
  if (loginBtn) {
    loginBtn.onclick = async () => {
      const { error } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.href }
      });
      if (error) {
        console.error(error);
        showToast(`Login failed: ${error.message}`);
      }
    };
  }

  const logoutBtn = qs('#logoutBtn');
  if (logoutBtn) {
    logoutBtn.onclick = async () => {
      const { error } = await client.auth.signOut();
      if (error) {
        console.error(error);
        showToast(`Logout failed: ${error.message}`);
      }
    };
  }

  document.querySelectorAll('.nav-item[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.view = btn.dataset.view || 'library';
      state.activePlaylistId = null;
      render();
    });
  });

  qs('#createPlaylistBtn')?.addEventListener('click', createPlaylistFromPrompt);

  qs('#searchInput')?.addEventListener('input', (e) => {
    state.searchQuery = e.target.value || '';
    render();
  });

  qs('#fileInput')?.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    await uploadFiles(files);
  });

  qs('#playBtn')?.addEventListener('click', togglePlayPause);
  qs('#bigPlayBtn')?.addEventListener('click', togglePlayPause);
  qs('#prevBtn')?.addEventListener('click', handlePrev);
  qs('#nextBtn')?.addEventListener('click', async () => playRelative(1));

  qs('#shuffleBtn')?.addEventListener('click', () => {
    state.isShuffle = !state.isShuffle;
    setShuffleButtonState();
  });

  qs('#loopBtn')?.addEventListener('click', () => {
    state.repeatMode = (state.repeatMode + 1) % 3;
    setLoopButtonState();
    showToast(LOOP_TITLES[state.repeatMode]);
  });

  const volume = qs('#volume');
  if (volume) {
    const initial = clamp(Number(localStorage.getItem('kp_volume') || '100'), 0, 100);
    volume.value = String(initial);
    audio.volume = initial / 100;
    volume.addEventListener('input', (e) => {
      const value = clamp(Number(e.target.value), 0, 100);
      audio.volume = value / 100;
      localStorage.setItem('kp_volume', String(value));
    });
  }

  qs('#progressBar')?.addEventListener('input', (e) => {
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
    audio.currentTime = (Number(e.target.value) / 100) * audio.duration;
  });

  qs('#presetSelect')?.addEventListener('change', (e) => {
    const next = String(e.target.value || '');
    if (next === '__separator') {
      renderPresetOptions(savedEq.preset);
      return;
    }
    applyPreset(next);
  });
  qs('#savePresetBtn')?.addEventListener('click', saveCurrentPreset);

  [['#fxClarity', 0], ['#fxAmbience', 1], ['#fxSurround', 2], ['#fxDynamic', 3], ['#fxBass', 4]].forEach(([sel, idx]) => {
    qs(sel)?.addEventListener('input', (e) => {
      savedEq.effects[idx] = clamp(Number(e.target.value), 0, 100);
      savedEq.preset = 'custom';
      persistEq();
      applyDSP();
      const preset = qs('#presetSelect');
      if (preset) preset.value = 'custom';
    });
  });

  qs('#eqModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'eqModal') qs('#eqModal')?.classList.add('hidden');
  });

  qs('#playlistPickerModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'playlistPickerModal') closePlaylistPicker();
  });

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');

    if (btn?.id === 'eqBtn') {
      qs('#eqModal')?.classList.remove('hidden');
      return;
    }

    if (btn?.dataset.action === 'close-eq') {
      qs('#eqModal')?.classList.add('hidden');
      return;
    }

    if (btn?.dataset.action === 'close-playlist-picker') {
      closePlaylistPicker();
      return;
    }

    if (btn?.id === 'eqToggleBtn') {
      savedEq.isOn = !savedEq.isOn;
      persistEq();
      syncEqControls();
      return;
    }

    if (btn?.dataset.action === 'open-playlist') {
      state.view = 'playlist';
      state.activePlaylistId = btn.dataset.id || null;
      render();
      return;
    }

    if (btn?.dataset.action === 'delete-playlist') {
      await deletePlaylist(btn.dataset.id);
      return;
    }

    if (btn?.dataset.action === 'pick-playlist') {
      if (state.pendingPlaylistSongId) {
        await addSongToPlaylist(state.pendingPlaylistSongId, btn.dataset.id);
      }
      closePlaylistPicker();
      return;
    }

    if (btn?.dataset.action === 'open-playlist-picker') {
      openPlaylistPicker(btn.dataset.id);
      return;
    }

    if (btn?.dataset.action === 'remove-from-playlist') {
      await removeSongFromPlaylist(btn.dataset.id, btn.dataset.playlistId);
      return;
    }

    if (btn?.dataset.action === 'toggle-like') {
      await toggleFavorite(btn.dataset.id);
      return;
    }

    if (btn?.dataset.action === 'toggle-queue') {
      toggleQueue(btn.dataset.id);
      return;
    }

    if (btn?.dataset.action === 'delete-song') {
      await deleteSongFromLibrary(btn.dataset.id);
      return;
    }

    const row = e.target.closest('.row');
    if (row && !e.target.closest('.actions-cell')) {
      const songs = getViewSongs();
      const selected = songs.find((s) => s.id === row.dataset.id) || findSongById(row.dataset.id);
      if (selected) await playSong(selected, songs);
    }
  });
}

async function handleSignedIn(user) {
  state.user = user;
  if (qs('#userEmail')) qs('#userEmail').textContent = user.email || 'User';
  setAuthView(true);

  await Promise.all([fetchSongs(), fetchFavorites(), fetchPlaylists()]);
  await fetchPlaylistTracks();

  removeMissingQueueItems();
  prunePlaylistTrackCache();
  ensureViewIntegrity();
  render();
}

function handleSignedOut() {
  state.user = null;
  state.songs = [];
  state.favorites = new Set();
  state.queue = [];
  state.playlists = [];
  state.playlistTracks = new Map();
  state.currentSong = null;
  state.currentContext = [];
  state.view = 'library';
  state.activePlaylistId = null;
  state.searchQuery = '';
  state.pendingPlaylistSongId = null;

  audio.pause();
  audio.src = '';

  if (qs('#nowTitle')) qs('#nowTitle').textContent = 'No song playing';
  if (qs('#nowSub')) qs('#nowSub').textContent = '-';
  if (qs('#timeCurrent')) qs('#timeCurrent').textContent = '0:00';
  if (qs('#timeTotal')) qs('#timeTotal').textContent = '0:00';
  if (qs('#progressBar')) qs('#progressBar').value = '0';
  if (qs('#searchInput')) qs('#searchInput').value = '';

  setPlayButton(false);
  setAuthView(false);
  closePlaylistPicker();
  render();
}

async function init() {
  bindAudioEvents();
  bindUiEvents();

  setPlayButton(false);
  setShuffleButtonState();
  setLoopButtonState();
  syncEqControls();

  const { data, error } = await client.auth.getSession();
  if (error) {
    console.error(error);
    showToast('Unable to get login session.');
  }

  if (data?.session?.user) {
    await handleSignedIn(data.session.user);
  } else {
    handleSignedOut();
  }

  client.auth.onAuthStateChange(async (_event, session) => {
    if (session?.user) {
      await handleSignedIn(session.user);
    } else {
      handleSignedOut();
    }
  });
}

init();





