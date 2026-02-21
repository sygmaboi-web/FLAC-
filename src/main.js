import './styles/app.css';
import { hasSupabaseConfig } from './config.js';
import { parseRoute, navigate } from './router.js';
import { qs } from './lib/dom.js';
import { authClient } from './modules/authClient.js';
import { songsClient } from './modules/songsClient.js';
import { playlistClient } from './modules/playlistClient.js';
import { queueClient } from './modules/queueClient.js';
import { shareClient } from './modules/shareClient.js';
import { offlineClient } from './modules/offlineClient.js';
import { metadataParser } from './modules/metadataParser.js';
import { AudioEngine } from './modules/audioEngine.js';
import { getState, setState, updateState, subscribe, pushNotice, clearNotice, resetState } from './state/store.js';
import { renderAuthView } from './views/authView.js';
import { renderAppView } from './views/appView.js';
import { renderShareView } from './views/shareView.js';

const root = document.getElementById('app');
const SETTINGS_KEY = 'kingpin:audio-settings:v1';
const DEFAULT_EQ = { enabled: true, preamp: 0, bands: [0, 0, 0, 0, 0, 0, 0, 0, 0] };

let uploadedFiles = [];
let uploadCursor = -1;
let currentUploadMetadata = null;
let currentUploadFile = null;
const recentLogTsBySong = new Map();

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const normalizeEq = eq => ({
  enabled: typeof eq?.enabled === 'boolean' ? eq.enabled : true,
  preamp: clamp(Number(eq?.preamp) || 0, -12, 12),
  bands: DEFAULT_EQ.bands.map((_, i) => clamp(Number(eq?.bands?.[i]) || 0, -12, 12))
});

const readSettingsMap = () => {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
  } catch {
    return {};
  }
};

const saveCurrentSettings = () => {
  const userId = getState().currentUser?.id;
  if (!userId) return;
  const state = getState();
  const map = readSettingsMap();
  map[userId] = {
    eqState: normalizeEq(state.eqState),
    crossfadeSeconds: clamp(Number(state.player.crossfadeSeconds) || 4, 0, 8),
    volume: clamp(Number(state.player.volume) || 1, 0, 1)
  };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(map));
  } catch (error) {
    console.warn('failed to save settings', error);
  }
};

const applySettings = payload => {
  const eqState = normalizeEq(payload?.eqState || DEFAULT_EQ);
  const crossfadeSeconds = clamp(Number(payload?.crossfadeSeconds ?? 4), 0, 8);
  const volume = clamp(Number(payload?.volume ?? 1), 0, 1);
  updateState(prev => ({
    ...prev,
    eqState,
    player: { ...prev.player, crossfadeSeconds, volume }
  }));
  audioEngine.setEqState(eqState);
  audioEngine.setEqEnabled(eqState.enabled);
  audioEngine.setCrossfadeSeconds(crossfadeSeconds);
  audioEngine.setVolume(volume);
};

const getSongById = id => getState().library.find(song => song.id === id) || null;

const attachSignedUrls = async songs => {
  if (!songs.length) return [];
  const [audioRows, coverRows] = await Promise.all([songsClient.signedUrlBatch(songs.map(song => song.id)), songsClient.coverUrlBatch(songs)]);
  const audioMap = new Map(audioRows.map(row => [row.song_id, row.signed_url]));
  const coverMap = new Map(coverRows.map(row => [row.song_id, row.cover_url]));
  return songs.map(song => ({ ...song, signed_url: audioMap.get(song.id) || null, cover_signed_url: coverMap.get(song.id) || null }));
};

const hydrateRows = rows => {
  const map = new Map(getState().library.map(song => [song.id, song]));
  return (rows || []).map(item => ({ ...item, songs: { ...(item.songs || {}), ...(map.get(item.song_id) || {}) } }));
};

const loadPlaylistsAndTracks = async userId => {
  const playlists = await playlistClient.listPlaylists(userId);
  const playlistTracks = {};
  for (const playlist of playlists) {
    playlistTracks[playlist.id] = hydrateRows(await playlistClient.listPlaylistTracks(playlist.id));
  }
  return { playlists, playlistTracks };
};

const isVerifiedSession = session => Boolean(session?.user?.email_confirmed_at);

const ensureRouteAccess = async () => {
  const state = getState();
  if (state.route.name === 'share') return;
  if (!state.session) {
    if (state.route.name !== 'auth') navigate('/auth', { replace: true });
    return;
  }
  if (!isVerifiedSession(state.session)) {
    if (state.route.name !== 'auth') navigate('/auth', { replace: true });
    return;
  }
  if (state.route.name === 'auth') navigate('/app', { replace: true });
};

const getFilteredLibrary = state => {
  const q = (state.searchQuery || '').trim().toLowerCase();
  if (!q) return state.library;
  return state.library.filter(song => (
    String(song.title).toLowerCase().includes(q)
    || String(song.artist).toLowerCase().includes(q)
    || String(song.album).toLowerCase().includes(q)
  ));
};

const maybeLogRecent = async songId => {
  if (!songId) return;
  const now = Date.now();
  if (now - (recentLogTsBySong.get(songId) || 0) < 30000) return;
  recentLogTsBySong.set(songId, now);
  try {
    const userId = getState().currentUser?.id;
    if (!userId) return;
    await songsClient.addRecentlyPlayed(userId, songId, 'player');
  } catch (error) {
    console.warn('recent log failed', error);
  }
};

const audioEngine = new AudioEngine({
  onTrackChange: song => {
    updateState(prev => ({ ...prev, player: { ...prev.player, currentSongId: song?.id || null } }));
    render();
    maybeLogRecent(song?.id);
  },
  onPlaybackState: isPlaying => {
    updateState(prev => ({ ...prev, player: { ...prev.player, isPlaying } }));
    render();
  },
  onTimeUpdate: timing => {
    const seek = document.querySelector('input[data-action="seek"]');
    const labels = document.querySelectorAll('.seek-row span');
    if (seek) seek.value = timing.duration > 0 ? String(Math.round((timing.currentTime / timing.duration) * 100)) : '0';
    if (labels.length >= 2) {
      labels[0].textContent = timing.currentLabel;
      labels[1].textContent = timing.durationLabel;
    }
    updateState(prev => ({ ...prev, player: { ...prev.player, currentTime: timing.currentTime, duration: timing.duration } }));
  },
  onEnded: () => {
    playNext().catch(error => pushNotice('error', error.message || 'Failed to play next song'));
  }
});

const refreshQueue = async () => {
  const userId = getState().currentUser?.id;
  if (!userId) return;
  setState({ queue: hydrateRows(await queueClient.load(userId)) });
};

const refreshPlaylistTracks = async playlistId => {
  if (!playlistId) return;
  const tracks = await playlistClient.listPlaylistTracks(playlistId);
  updateState(prev => ({
    ...prev,
    playlistTracks: {
      ...prev.playlistTracks,
      [playlistId]: hydrateRows(tracks)
    }
  }));
};

const loadAppData = async () => {
  const userId = getState().currentUser?.id;
  if (!userId) return;

  const [songs, favorites, recentlyPlayed, queue] = await Promise.all([
    songsClient.listMySongs(userId),
    songsClient.listFavorites(userId),
    songsClient.listRecentlyPlayed(userId),
    queueClient.load(userId)
  ]);

  const library = await attachSignedUrls(songs);
  updateState(prev => ({ ...prev, library }));
  const libraryMap = new Map(library.map(song => [song.id, song]));
  const { playlists, playlistTracks } = await loadPlaylistsAndTracks(userId);
  const hydratedRecent = (recentlyPlayed || []).map(item => ({
    ...item,
    songs: {
      ...(item.songs || {}),
      ...(libraryMap.get(item.song_id) || {})
    }
  }));

  updateState(prev => ({
    ...prev,
    library,
    favorites,
    recentlyPlayed: hydratedRecent,
    queue: hydrateRows(queue),
    playlists,
    playlistTracks,
    activePlaylistId: playlists[0]?.id || null
  }));

  const map = readSettingsMap();
  if (map[userId]) applySettings(map[userId]);
  render();
  syncOfflineLibrary().catch(error => pushNotice('warning', `Offline sync warning: ${error.message || 'unknown error'}`));
};

const playSongById = async songId => {
  const song = getSongById(songId);
  if (!song) return;
  let streamUrl = song.signed_url;
  if (!navigator.onLine) streamUrl = await offlineClient.getOfflineObjectUrl(song.id);
  if (!streamUrl) {
    const refreshed = await attachSignedUrls([song]);
    streamUrl = refreshed[0]?.signed_url || null;
    updateState(prev => ({ ...prev, library: prev.library.map(item => (item.id === song.id ? refreshed[0] : item)) }));
  }
  if (!streamUrl) {
    pushNotice('error', `Cannot stream song ${song.title}`);
    return;
  }
  await audioEngine.playSong(song, streamUrl);
};

const computeNextSong = async currentSong => {
  const state = getState();
  if (state.queue.length) {
    const [queueItem] = state.queue;
    const song = getSongById(queueItem.song_id);
    if (song) {
      await queueClient.dequeue(state.currentUser.id, queueItem.id);
      updateState(prev => ({ ...prev, queue: prev.queue.slice(1) }));
      const url = navigator.onLine ? song.signed_url || (await attachSignedUrls([song]))[0]?.signed_url : await offlineClient.getOfflineObjectUrl(song.id);
      return url ? { song, url } : null;
    }
  }

  const library = state.library;
  if (!library.length) return null;
  if (!currentSong) return { song: library[0], url: library[0].signed_url };

  if (state.player.shuffle) {
    if (library.length === 1) return { song: library[0], url: library[0].signed_url };
    let candidate = library[Math.floor(Math.random() * library.length)];
    while (candidate.id === currentSong.id) candidate = library[Math.floor(Math.random() * library.length)];
    return { song: candidate, url: candidate.signed_url };
  }

  const currentIndex = library.findIndex(song => song.id === currentSong.id);
  const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % library.length : 0;
  return { song: library[nextIndex], url: library[nextIndex].signed_url };
};

audioEngine.setNextResolver(async currentSong => {
  const payload = await computeNextSong(currentSong);
  if (!payload?.song) return null;
  if (payload.url) return payload;
  const refreshed = await attachSignedUrls([payload.song]);
  const url = refreshed[0]?.signed_url || null;
  if (!url) return null;
  updateState(prev => ({ ...prev, library: prev.library.map(song => (song.id === payload.song.id ? refreshed[0] : song)) }));
  return { song: payload.song, url };
});

const playNext = async () => {
  const payload = await computeNextSong(getSongById(getState().player.currentSongId));
  if (!payload?.song) return;
  await playSongById(payload.song.id);
};

const playPrev = async () => {
  const state = getState();
  if (!state.library.length) return;
  const idx = state.library.findIndex(song => song.id === state.player.currentSongId);
  const prev = idx > 0 ? state.library[idx - 1] : state.library[state.library.length - 1];
  await playSongById(prev.id);
};

const syncOfflineLibrary = async () => {
  const state = getState();
  if (!state.currentUser) return;
  updateState(prev => ({
    ...prev,
    offlineSyncState: { ...prev.offlineSyncState, status: 'syncing', total: prev.library.length, synced: 0, failed: 0, message: 'Starting offline sync...' }
  }));
  render();

  const storage = await offlineClient.estimateStorage();
  const needed = state.library.reduce((acc, song) => acc + Number(song.size_bytes || 0), 0);
  if (storage.available !== null && needed > storage.available) {
    updateState(prev => ({
      ...prev,
      offlineSyncState: { ...prev.offlineSyncState, status: 'error', message: 'Storage quota is not enough for full offline sync' }
    }));
    render();
    return;
  }

  const result = await offlineClient.syncAllLibrary(state.library, progress => {
    updateState(prev => ({
      ...prev,
      offlineSyncState: { ...prev.offlineSyncState, status: 'syncing', total: progress.total, synced: progress.synced, failed: progress.failed }
    }));
    render();
  });

  updateState(prev => ({
    ...prev,
    offlineSyncState: {
      ...prev.offlineSyncState,
      status: result.failed ? 'partial' : 'done',
      synced: result.synced,
      total: result.total,
      failed: result.failed,
      lastSyncedAt: new Date().toISOString(),
      message: result.failed ? 'Offline sync finished with failures' : 'Offline sync completed'
    }
  }));
  render();
};

const openUploadModal = ({ metadata, file }) => {
  const modal = qs('#uploadModal', root);
  if (!modal) return;
  modal.classList.remove('hidden');
  qs('#uploadModalSongLabel', root).textContent = file.name;
  qs('#metaTitle', root).value = metadata.title || '';
  qs('#metaArtist', root).value = metadata.artist || '';
  qs('#metaAlbum', root).value = metadata.album || '';
  qs('#metaTrack', root).value = metadata.track_number || '';
  qs('#metaYear', root).value = metadata.year || '';
  qs('#metaGenre', root).value = metadata.genre || '';
  const coverInput = qs('#metaCover', root);
  if (coverInput) coverInput.value = '';
};

const closeUploadModal = () => {
  const modal = qs('#uploadModal', root);
  if (modal) modal.classList.add('hidden');
};

const prepareUploadAtCursor = async () => {
  if (uploadCursor < 0 || uploadCursor >= uploadedFiles.length) {
    currentUploadMetadata = null;
    currentUploadFile = null;
    closeUploadModal();
    return;
  }
  currentUploadFile = uploadedFiles[uploadCursor];
  currentUploadMetadata = await metadataParser.parseFile(currentUploadFile);
  openUploadModal({ metadata: currentUploadMetadata, file: currentUploadFile });
};

const movePlaylistTrack = async ({ playlistId, trackId, direction }) => {
  const tracks = getState().playlistTracks[playlistId] || [];
  const index = tracks.findIndex(item => String(item.id) === String(trackId));
  if (index < 0) return;
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= tracks.length) return;
  const reordered = [...tracks];
  const [moved] = reordered.splice(index, 1);
  reordered.splice(target, 0, moved);
  await playlistClient.reorderTracks(playlistId, reordered.map(item => item.id));
  await refreshPlaylistTracks(playlistId);
};

const moveQueueItem = async ({ queueId, direction }) => {
  const queue = getState().queue || [];
  const index = queue.findIndex(item => String(item.id) === String(queueId));
  if (index < 0) return;
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= queue.length) return;
  const reordered = [...queue];
  const [moved] = reordered.splice(index, 1);
  reordered.splice(target, 0, moved);
  await queueClient.reorder(getState().currentUser.id, reordered.map(item => item.id));
  await refreshQueue();
};

const handlers = {
  onGoogleSignIn: async () => authClient.signInWithGoogle(),
  onEmailSignIn: async event => {
    event.preventDefault();
    await authClient.signInWithEmail(qs('#signInEmail', root).value.trim(), qs('#signInPassword', root).value);
  },
  onEmailSignUp: async event => {
    event.preventDefault();
    await authClient.signUpWithEmail(qs('#signUpEmail', root).value.trim(), qs('#signUpPassword', root).value, qs('#signUpName', root).value.trim());
    pushNotice('info', 'Account created. Check your email for verification link.');
    render();
  },
  onResetPassword: async event => {
    event.preventDefault();
    await authClient.resetPassword(qs('#resetEmail', root).value.trim());
    pushNotice('info', 'Password reset email sent.');
    render();
  },
  onResendVerification: async () => {
    const email = getState().session?.user?.email;
    if (!email) return;
    await authClient.resendVerification(email);
    pushNotice('info', 'Verification email resent.');
    render();
  },
  onOpenApp: () => navigate('/app'),
  onSignOut: async () => authClient.signOut(),
  logout: async () => authClient.signOut(),
  'switch-view': (_e, el) => {
    const view = el.getAttribute('data-view');
    if (!view) return;
    setState({ view });
    render();
  },
  search: event => {
    setState({ searchQuery: event.target.value });
    render();
  },
  'play-song': async (_e, el) => {
    const songId = el.getAttribute('data-song-id');
    if (songId) await playSongById(songId);
  },
  'play-next': async (_e, el) => {
    const songId = el.getAttribute('data-song-id');
    if (!songId) return;
    const state = getState();
    if (!state.player.currentSongId) {
      await playSongById(songId);
      return;
    }
    await queueClient.enqueueNext(state.currentUser.id, songId);
    await refreshQueue();
    pushNotice('success', 'Track set to play next.');
    render();
  },
  'toggle-like': async (_e, el) => {
    const songId = el.getAttribute('data-song-id');
    if (!songId) return;
    const state = getState();
    const likedSet = new Set(state.favorites.map(item => item.song_id));
    await songsClient.toggleFavorite(state.currentUser.id, songId, !likedSet.has(songId));
    setState({ favorites: await songsClient.listFavorites(state.currentUser.id) });
    render();
  },
  'add-queue': async (_e, el) => {
    const songId = el.getAttribute('data-song-id');
    if (!songId) return;
    await queueClient.enqueue(getState().currentUser.id, songId);
    await refreshQueue();
    render();
  },
  'remove-queue': async (_e, el) => {
    const id = el.getAttribute('data-queue-id');
    if (!id) return;
    await queueClient.dequeue(getState().currentUser.id, Number(id));
    await refreshQueue();
    render();
  },
  'move-queue-up': async (_e, el) => {
    const id = el.getAttribute('data-queue-id');
    if (id) await moveQueueItem({ queueId: id, direction: 'up' });
    render();
  },
  'move-queue-down': async (_e, el) => {
    const id = el.getAttribute('data-queue-id');
    if (id) await moveQueueItem({ queueId: id, direction: 'down' });
    render();
  },
  'delete-song': async (_e, el) => {
    const songId = el.getAttribute('data-song-id');
    if (!songId) return;
    const song = getSongById(songId);
    if (!song || !window.confirm(`Delete "${song.title}" permanently?`)) return;
    await songsClient.deleteSong(song);
    await loadAppData();
  },
  'create-playlist': async () => {
    const input = qs('#newPlaylistName', root);
    const name = input?.value.trim();
    if (!name) return;
    await playlistClient.createPlaylist(getState().currentUser.id, { name });
    input.value = '';
    const playlists = await playlistClient.listPlaylists(getState().currentUser.id);
    const playlistTracks = {};
    for (const playlist of playlists) playlistTracks[playlist.id] = hydrateRows(await playlistClient.listPlaylistTracks(playlist.id));
    setState({ playlists, playlistTracks, activePlaylistId: playlists[0]?.id || null });
    render();
  },
  'select-playlist': (_e, el) => {
    const id = el.getAttribute('data-playlist-id');
    if (id) setState({ activePlaylistId: id });
    render();
  },
  'toggle-playlist-public': async (event, el) => {
    const id = el.getAttribute('data-playlist-id');
    if (!id) return;
    await playlistClient.updatePlaylist(id, { is_public: Boolean(event.target.checked) });
    setState({ playlists: await playlistClient.listPlaylists(getState().currentUser.id) });
    render();
  },
  'share-playlist': async (_e, el) => {
    const id = el.getAttribute('data-playlist-id');
    if (!id) return;
    const data = await shareClient.createShareLink(id, { requiresLogin: false });
    pushNotice('success', `Share link created: ${data.share_url}`);
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(data.share_url);
    render();
  },
  'delete-playlist': async (_e, el) => {
    const id = el.getAttribute('data-playlist-id');
    if (!id) return;
    await playlistClient.deletePlaylist(id);
    const playlists = await playlistClient.listPlaylists(getState().currentUser.id);
    const playlistTracks = {};
    for (const playlist of playlists) playlistTracks[playlist.id] = hydrateRows(await playlistClient.listPlaylistTracks(playlist.id));
    setState({ playlists, playlistTracks, activePlaylistId: playlists[0]?.id || null });
    render();
  },
  'add-to-playlist': async (_e, el) => {
    const playlistId = el.value;
    const songId = el.getAttribute('data-song-id');
    if (!playlistId || !songId) return;
    await playlistClient.addTrack(playlistId, songId);
    await refreshPlaylistTracks(playlistId);
    el.value = '';
    render();
  },
  'remove-playlist-track': async (_e, el) => {
    const playlistId = el.getAttribute('data-playlist-id');
    const trackId = el.getAttribute('data-track-id');
    if (!playlistId || !trackId) return;
    await playlistClient.removeTrack(Number(trackId));
    await refreshPlaylistTracks(playlistId);
    render();
  },
  'move-playlist-track-up': async (_e, el) => {
    const playlistId = el.getAttribute('data-playlist-id');
    const trackId = el.getAttribute('data-track-id');
    if (playlistId && trackId) await movePlaylistTrack({ playlistId, trackId, direction: 'up' });
    render();
  },
  'move-playlist-track-down': async (_e, el) => {
    const playlistId = el.getAttribute('data-playlist-id');
    const trackId = el.getAttribute('data-track-id');
    if (playlistId && trackId) await movePlaylistTrack({ playlistId, trackId, direction: 'down' });
    render();
  },
  'open-upload-modal': async () => {
    if (!uploadedFiles.length) {
      pushNotice('warning', 'Select one or more audio files first.');
      render();
      return;
    }
    uploadCursor = 0;
    await prepareUploadAtCursor();
  },
  'cancel-upload-modal': () => closeUploadModal(),
  captureUploadFiles: event => {
    uploadedFiles = Array.from(event.target.files || []);
    uploadCursor = -1;
    currentUploadFile = null;
    currentUploadMetadata = null;
    setState({ pendingUploadsCount: uploadedFiles.length });
    pushNotice('info', `${uploadedFiles.length} file(s) selected.`);
    render();
  },
  submitMetadataUpload: async event => {
    event.preventDefault();
    if (!currentUploadFile || !currentUploadMetadata) return;
    const coverInput = qs('#metaCover', root);
    const metadata = {
      ...currentUploadMetadata,
      title: qs('#metaTitle', root).value.trim() || currentUploadMetadata.title || 'Untitled',
      artist: qs('#metaArtist', root).value.trim() || currentUploadMetadata.artist || 'Unknown Artist',
      album: qs('#metaAlbum', root).value.trim() || currentUploadMetadata.album || 'Single',
      track_number: Number(qs('#metaTrack', root).value) || null,
      year: Number(qs('#metaYear', root).value) || null,
      genre: qs('#metaGenre', root).value.trim() || null,
      coverBlob: coverInput?.files?.[0] || currentUploadMetadata.coverBlob || null
    };
    await songsClient.uploadSong({ userId: getState().currentUser.id, file: currentUploadFile, metadata });
    uploadCursor += 1;
    if (uploadCursor >= uploadedFiles.length) {
      uploadedFiles = [];
      uploadCursor = -1;
      setState({ pendingUploadsCount: 0 });
      const input = qs('#uploadInput', root);
      if (input) input.value = '';
      closeUploadModal();
      pushNotice('success', 'Upload complete.');
      await loadAppData();
      return;
    }
    await prepareUploadAtCursor();
  },
  'dismiss-notice': (_e, el) => {
    const id = el.getAttribute('data-notice-id');
    if (!id) return;
    clearNotice(id);
    render();
  },
  'sync-offline': async () => syncOfflineLibrary(),
  'toggle-shuffle': () => {
    updateState(prev => ({ ...prev, player: { ...prev.player, shuffle: !prev.player.shuffle } }));
    render();
  },
  prev: async () => playPrev(),
  next: async () => playNext(),
  'toggle-play': async () => audioEngine.togglePlayPause(),
  seek: event => audioEngine.seekTo(Number(event.target.value)),
  volume: event => {
    const volume = Number(event.target.value) / 100;
    audioEngine.setVolume(volume);
    updateState(prev => ({ ...prev, player: { ...prev.player, volume } }));
  },
  crossfade: event => {
    const seconds = Number(event.target.value);
    audioEngine.setCrossfadeSeconds(seconds);
    updateState(prev => ({ ...prev, player: { ...prev.player, crossfadeSeconds: seconds } }));
    render();
  },
  'eq-toggle': event => {
    const enabled = Boolean(event.target.checked);
    audioEngine.setEqEnabled(enabled);
    updateState(prev => ({ ...prev, eqState: { ...prev.eqState, enabled } }));
  },
  'toggle-eq-panel': () => {
    updateState(prev => ({ ...prev, eqPanelOpen: !prev.eqPanelOpen }));
    render();
  },
  'eq-preamp': event => {
    updateState(prev => ({ ...prev, eqState: { ...prev.eqState, preamp: Number(event.target.value) } }));
    audioEngine.setEqState(getState().eqState);
    render();
  },
  'eq-band': (event, el) => {
    const index = Number(el.getAttribute('data-band-index'));
    const value = Number(event.target.value);
    updateState(prev => {
      const bands = [...prev.eqState.bands];
      bands[index] = value;
      return { ...prev, eqState: { ...prev.eqState, bands } };
    });
    audioEngine.setEqState(getState().eqState);
    render();
  },
  'save-eq': () => {
    saveCurrentSettings();
    pushNotice('success', 'EQ and audio settings saved.');
    render();
  },
  'reset-eq': () => {
    applySettings({ eqState: DEFAULT_EQ, crossfadeSeconds: 4, volume: 1 });
    pushNotice('info', 'EQ reset to default.');
    render();
  }
};

const render = () => {
  const state = getState();
  if (state.route.name === 'auth') {
    renderAuthView({ root, state, handlers });
    return;
  }

  if (state.route.name === 'share') {
    renderShareView({
      root,
      payload: state.sharePayload,
      onOpenApp: () => navigate('/app'),
      onPlayTrack: songId => {
        const track = state.sharePayload?.tracks_with_signed_urls?.find(item => String(item.id) === String(songId));
        if (!track?.signed_url) return;
        const player = document.getElementById('shareAudio');
        if (!player) return;
        player.src = track.signed_url;
        player.play().catch(console.warn);
      }
    });
    return;
  }

  renderAppView({
    root,
    state: { ...state, filteredLibrary: getFilteredLibrary(state) },
    handlers
  });
};

const loadShareRouteData = async token => {
  try {
    setState({ sharePayload: await shareClient.resolveShareLink(token) });
  } catch (error) {
    setState({ sharePayload: null });
    pushNotice('error', error.message || 'Unable to resolve share link');
  }
  render();
};

const bootstrap = async () => {
  if (!hasSupabaseConfig()) {
    root.innerHTML = `
      <div class="app-error">
        <h1>Supabase config missing</h1>
        <p>Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> before running.</p>
      </div>
    `;
    return;
  }

  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('/sw.js');
    } catch (error) {
      console.warn('service worker failed', error);
    }
  }

  applySettings({ eqState: DEFAULT_EQ, crossfadeSeconds: 4, volume: 1 });
  setState({ route: parseRoute(window.location.pathname) });
  render();

  window.addEventListener('popstate', async () => {
    setState({ route: parseRoute(window.location.pathname) });
    if (getState().route.name === 'share') {
      await loadShareRouteData(getState().route.params.token);
      return;
    }
    await ensureRouteAccess();
    render();
  });

  const session = await authClient.getSession();
  setState({ session, currentUser: session?.user || null });

  authClient.onAuthStateChange(async nextSession => {
    if (!nextSession) {
      resetState();
      setState({ route: parseRoute('/auth') });
      navigate('/auth', { replace: true });
      render();
      return;
    }

    setState({ session: nextSession, currentUser: nextSession.user });
    await ensureRouteAccess();
    if (isVerifiedSession(nextSession)) await loadAppData();
    render();
  });

  if (getState().route.name === 'share') {
    await loadShareRouteData(getState().route.params.token);
    return;
  }

  await ensureRouteAccess();
  if (session && isVerifiedSession(session)) await loadAppData();
  render();
};

subscribe(() => {});
bootstrap().catch(error => {
  console.error(error);
  root.innerHTML = `<div class="app-error"><h1>App failed to start</h1><p>${error.message || 'Unknown error'}</p></div>`;
});

