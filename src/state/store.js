const listeners = new Set();

const initialState = {
  session: null,
  currentUser: null,
  route: { name: 'app', params: {} },
  view: 'home',
  searchQuery: '',
  pendingUploadsCount: 0,
  library: [],
  playlists: [],
  playlistTracks: {},
  queue: [],
  favorites: [],
  recentlyPlayed: [],
  sharePayload: null,
  offlineSyncState: {
    status: 'idle',
    total: 0,
    synced: 0,
    failed: 0,
    lastSyncedAt: null,
    message: ''
  },
  player: {
    currentSongId: null,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    volume: 1,
    shuffle: false,
    crossfadeSeconds: 4
  },
  eqState: {
    enabled: true,
    preamp: 0,
    bands: [0, 0, 0, 0, 0, 0, 0, 0, 0]
  },
  eqPanelOpen: false,
  notices: []
};

let state = structuredClone(initialState);

export const getState = () => state;

export const setState = patch => {
  state = {
    ...state,
    ...patch
  };
  listeners.forEach(listener => listener(state));
};

export const updateState = updater => {
  const next = updater(state);
  state = next;
  listeners.forEach(listener => listener(state));
};

export const subscribe = listener => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const pushNotice = (type, text) => {
  updateState(prev => ({
    ...prev,
    notices: [...prev.notices, { id: crypto.randomUUID(), type, text, createdAt: Date.now() }]
  }));
};

export const clearNotice = id => {
  updateState(prev => ({
    ...prev,
    notices: prev.notices.filter(n => n.id !== id)
  }));
};

export const resetState = () => {
  state = structuredClone(initialState);
  listeners.forEach(listener => listener(state));
};

