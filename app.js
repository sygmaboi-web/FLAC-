/* global supabase */

const SUPABASE_URL = 'https:gizslqqltboughqtzwla.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdpenNscXFsdGJvdWdocXR6d2xhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3MDg3NDcsImV4cCI6MjA4NzI4NDc0N30.CYjSPFKNBmYzugfaO-69RzRPNMq60Tp8uPXlHwg31mQ';

const client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const state = {
  user: null,
  songs: [],
  favorites: new Set(),
  recent: [],
  playlists: [],
  queue: JSON.parse(localStorage.getItem('kp_queue') || '[]'),
  currentSong: null,
  search: '',
  view: 'library'
};

// --- Audio & Equalizer Engine (10 Bands) ---
const audio = new Audio();
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const source = audioCtx.createMediaElementSource(audio);
const preamp = audioCtx.createGain();

const eqFrequencies = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const eqLabels = ['32', '64', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];

// Load saved EQ settings or default to 0
let savedEq = JSON.parse(localStorage.getItem('kp_eq_settings') || '[]');

const bands = eqFrequencies.map((freq, i) => {
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'peaking';
  filter.frequency.value = freq;
  filter.Q.value = 1.41; // Q factor standard
  filter.gain.value = savedEq[i] || 0;
  return filter;
});

let lastNode = preamp;
bands.forEach(filter => {
  lastNode.connect(filter);
  lastNode = filter;
});
lastNode.connect(audioCtx.destination);
source.connect(preamp);

// Render EQ Sliders to HTML
const renderEqSliders = () => {
  const container = document.getElementById('eqSlidersContainer');
  container.innerHTML = bands.map((band, i) => `
    <div class="eq-band">
      <input class="eq-slider" data-band="${i}" type="range" min="-12" max="12" step="1" value="${band.gain.value}" orient="vertical" />
      <span class="eq-label">${eqLabels[i]}</span>
    </div>
  `).join('');
};
renderEqSliders();

// --- Helpers ---
const qs = sel => document.querySelector(sel);
const toast = msg => {
  const el = qs('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3000);
};

// --- Auth & View Logic ---
const checkAuthAndRenderUI = () => {
  if (state.user) {
    qs('#loginView').classList.add('hidden');
    qs('#mainApp').classList.remove('hidden');
    qs('#userEmail').textContent = state.user.email;
    render();
  } else {
    qs('#loginView').classList.remove('hidden');
    qs('#mainApp').classList.add('hidden');
  }
};

// --- Fetch Data ---
const fetchSongs = async () => {
  const { data, error } = await client.from('songs').select('*').eq('owner_id', state.user.id).order('created_at', { ascending: false });
  return data || [];
};
const fetchFavorites = async () => {
  const { data } = await client.from('favorites').select('song_id').eq('user_id', state.user.id);
  return new Set((data || []).map(item => item.song_id));
};
const fetchRecent = async () => {
  const { data } = await client.from('recently_played').select('song_id, played_at, songs(*)').eq('user_id', state.user.id).order('played_at', { ascending: false }).limit(30);
  return data || [];
};
const fetchPlaylists = async () => {
  const { data } = await client.from('playlists').select('*').eq('owner_id', state.user.id).order('created_at', { ascending: false });
  return data || [];
};
const fetchPlaylistTracks = async playlistId => {
  const { data } = await client.from('playlist_tracks').select('id, position, songs(*)').eq('playlist_id', playlistId).order('position', { ascending: true });
  return data || [];
};

const signedUrl = async path => {
  const { data } = await client.storage.from('user-audio').createSignedUrl(path, 60 * 30);
  return data?.signedUrl || null;
};

const loadData = async () => {
  if (!state.user) return;
  [state.songs, state.favorites, state.recent, state.playlists] = await Promise.all([
    fetchSongs(), fetchFavorites(), fetchRecent(), fetchPlaylists()
  ]);
};

// --- Playback ---
const playSong = async song => {
  if (audioCtx.state === 'suspended') await audioCtx.resume();
  if (!song?.audio_path) return;
  const url = await signedUrl(song.audio_path);
  if (!url) return;
  
  state.currentSong = song;
  qs('#nowTitle').textContent = song.title || 'Untitled';
  qs('#nowSub').textContent = song.artist || 'Unknown Artist';
  
  audio.src = url;
  await audio.play();
  
  // Icon play/pause update
  qs('#playBtn').innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5.7 3a.7.7 0 0 0-.7.7v16.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V3.7a.7.7 0 0 0-.7-.7H5.7zm10 0a.7.7 0 0 0-.7.7v16.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V3.7a.7.7 0 0 0-.7-.7h-2.6z"/></svg>`;
  
  await client.from('recently_played').insert({ user_id: state.user.id, song_id: song.id, source: 'player' });
};

// --- Rendering ---
const renderList = items => {
  if (!items.length) return '<div class="row" style="color:var(--text-subdued)">No songs found.</div>';
  return `
    <div class="list">
      ${items.map(song => `
        <div class="row">
          <div>
            <div style="font-weight: 600; color: ${state.currentSong?.id === song.id ? 'var(--spotify-green)' : 'var(--text-base)'}">${song.title}</div>
            <div class="meta">${song.artist || 'Unknown Artist'} • ${song.album || 'Single'}</div>
          </div>
          <div class="actions">
            <button class="btn ghost btn-sm" data-action="play" data-id="${song.id}">Play</button>
            <button class="btn ghost btn-sm" data-action="like" data-id="${song.id}">
              ${state.favorites.has(song.id) ? '♥' : '♡'}
            </button>
            <button class="btn ghost btn-sm" data-action="queue" data-id="${song.id}">Queue</button>
            <button class="btn ghost btn-sm" data-action="delete" data-id="${song.id}">Delete</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;
};

const render = async () => {
  const titles = { library: 'Your Collection', liked: 'Liked Songs', recent: 'Recently Played', playlists: 'Your Playlists', queue: 'Play Queue' };
  qs('#viewTitle').textContent = titles[state.view] || 'Library';

  let html = '';
  if (state.view === 'library') {
    const filtered = state.songs.filter(s => `${s.title} ${s.artist}`.toLowerCase().includes(state.search.toLowerCase()));
    html = renderList(filtered);
  } else if (state.view === 'liked') {
    html = renderList(state.songs.filter(s => state.favorites.has(s.id)));
  } else if (state.view === 'recent') {
    html = renderList(state.recent.map(r => r.songs).filter(Boolean));
  } else if (state.view === 'queue') {
    html = renderList(state.queue.map(id => state.songs.find(s => s.id === id)).filter(Boolean));
  } else if (state.view === 'playlists') {
    html = `
      <div style="display:flex; gap:12px; margin-bottom: 24px;">
        <input id="playlistName" placeholder="New playlist name..." style="padding:10px; border-radius:4px; border:none; background:var(--bg-elevated); color:#fff; width:300px;"/>
        <button id="createPlaylist" class="btn primary">Create</button>
      </div>
      <div class="list">
        ${state.playlists.map(pl => `
          <div class="row">
            <div><div style="font-weight:600">${pl.name}</div><div class="meta">${pl.is_public ? 'Public' : 'Private'}</div></div>
            <div class="actions">
              <button class="btn ghost btn-sm" data-action="open-playlist" data-id="${pl.id}">Open</button>
              <button class="btn ghost btn-sm" data-action="share" data-id="${pl.id}">Share</button>
            </div>
          </div>
        `).join('')}
      </div>
      <div id="playlistTracks" style="margin-top: 24px;"></div>
    `;
  }
  qs('#viewContent').innerHTML = html;
};

// --- Init & Auth Listeners ---
const init = async () => {
  const { data } = await client.auth.getSession();
  state.user = data?.session?.user || null;
  if (state.user) await loadData();
  checkAuthAndRenderUI();
};

client.auth.onAuthStateChange(async (_event, session) => {
  state.user = session?.user || null;
  if (state.user) await loadData();
  checkAuthAndRenderUI();
});

qs('#loginBtn').onclick = async () => {
  await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
};
qs('#logoutBtn').onclick = async () => {
  await client.auth.signOut();
};

// --- Upload ---
qs('#fileInput').onchange = async e => {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  toast('Uploading...');
  for (const file of files) {
    const songId = crypto.randomUUID();
    const ext = file.name.split('.').pop() || 'mp3';
    const audioPath = `users/${state.user.id}/songs/${songId}.${ext}`;
    await client.storage.from('user-audio').upload(audioPath, file, { contentType: file.type || 'audio/mpeg' });
    await client.from('songs').insert({
      id: songId, owner_id: state.user.id, title: file.name.replace(/\.[^/.]+$/, ''), artist: 'Unknown Artist', album: 'Single', audio_path: audioPath
    });
  }
  toast('Upload complete');
  await loadData(); render();
};

// --- Global Event Delegation ---
document.addEventListener('click', async e => {
  if (audioCtx.state === 'suspended') await audioCtx.resume();
  
  const btn = e.target.closest('button');
  if (!btn) return;

  // Navigations
  if (btn.classList.contains('nav-item')) {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.view = btn.dataset.view;
    render();
    return;
  }

  // Playlist Create
  if (btn.id === 'createPlaylist') {
    const name = qs('#playlistName').value.trim();
    if (!name) return;
    await client.from('playlists').insert({ owner_id: state.user.id, name });
    state.playlists = await fetchPlaylists();
    render();
    return;
  }

  // EQ Modals
  if (btn.id === 'eqBtn') return qs('#eqModal').classList.remove('hidden');
  if (btn.dataset.action === 'close-eq') return qs('#eqModal').classList.add('hidden');
  if (btn.dataset.action === 'reset-eq') {
    bands.forEach((b, i) => { b.gain.value = 0; savedEq[i] = 0; });
    localStorage.setItem('kp_eq_settings', JSON.stringify(savedEq));
    renderEqSliders();
    return;
  }

  // Actions
  const action = btn.dataset.action;
  const id = btn.dataset.id;
  if (!action || !id) return;

  if (action === 'play') {
    const song = state.songs.find(item => item.id === id);
    await playSong(song);
    render();
  }
  if (action === 'like') {
    if (state.favorites.has(id)) await client.from('favorites').delete().eq('user_id', state.user.id).eq('song_id', id);
    else await client.from('favorites').insert({ user_id: state.user.id, song_id: id });
    state.favorites = await fetchFavorites();
    render();
  }
  if (action === 'queue') {
    state.queue.push(id);
    localStorage.setItem('kp_queue', JSON.stringify(state.queue));
    toast('Added to queue');
  }
  if (action === 'delete') {
    const song = state.songs.find(item => item.id === id);
    await client.storage.from('user-audio').remove([song.audio_path]);
    await client.from('songs').delete().eq('id', id);
    await loadData(); render();
  }
  if (action === 'share') {
    await client.from('playlists').update({ is_public: true }).eq('id', id);
    navigator.clipboard.writeText(`${window.location.origin}/#share/${id}`);
    toast('Share link copied!');
  }
});

// --- EQ Sliders Change Event ---
document.addEventListener('input', e => {
  if (e.target.classList.contains('eq-slider')) {
    const idx = Number(e.target.dataset.band);
    const val = Number(e.target.value);
    bands[idx].gain.value = val;
    savedEq[idx] = val;
    localStorage.setItem('kp_eq_settings', JSON.stringify(savedEq));
  }
});

// --- Player Controls ---
qs('#searchInput').oninput = e => { state.search = e.target.value; render(); };
qs('#volume').oninput = e => { audio.volume = Number(e.target.value) / 100; };
qs('#prevBtn').onclick = () => {
  const idx = state.songs.findIndex(song => song.id === state.currentSong?.id);
  if (idx > 0) playSong(state.songs[idx - 1]);
};
qs('#nextBtn').onclick = () => {
  const idx = state.songs.findIndex(song => song.id === state.currentSong?.id);
  if (idx >= 0 && idx < state.songs.length - 1) playSong(state.songs[idx + 1]);
};
qs('#playBtn').onclick = async () => {
  if (audioCtx.state === 'suspended') await audioCtx.resume();
  if (audio.paused) {
    await audio.play();
    qs('#playBtn').innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5.7 3a.7.7 0 0 0-.7.7v16.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V3.7a.7.7 0 0 0-.7-.7H5.7zm10 0a.7.7 0 0 0-.7.7v16.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V3.7a.7.7 0 0 0-.7-.7h-2.6z"/></svg>`;
  } else {
    audio.pause();
    qs('#playBtn').innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7.05 3.606l13.49 7.788a.7.7 0 0 1 0 1.212L7.05 20.394A.7.7 0 0 1 6 19.788V4.212a.7.7 0 0 1 1.05-.606z"/></svg>`;
  }
};

window.addEventListener('load', init);
