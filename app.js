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
  playlistTracks: {},
  queue: JSON.parse(localStorage.getItem('kp_queue') || '[]'),
  currentSong: null,
  currentUrl: null,
  search: '',
  view: 'library'
};

const audio = new Audio();
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const source = audioCtx.createMediaElementSource(audio);
const preamp = audioCtx.createGain();
const bands = [60, 230, 910, 3600, 14000].map(freq => {
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'peaking';
  filter.frequency.value = freq;
  filter.Q.value = 1;
  filter.gain.value = 0;
  return filter;
});

let lastNode = preamp;
bands.forEach(filter => {
  lastNode.connect(filter);
  lastNode = filter;
});
lastNode.connect(audioCtx.destination);
source.connect(preamp);

const qs = sel => document.querySelector(sel);
const toast = msg => {
  const el = qs('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 2500);
};

const setUserUI = () => {
  qs('#userEmail').textContent = state.user?.email || 'Not signed in';
  qs('#loginBtn').classList.toggle('hidden', Boolean(state.user));
  qs('#logoutBtn').classList.toggle('hidden', !state.user);
};

const fetchSongs = async () => {
  if (!state.user) return [];
  const { data, error } = await client
    .from('songs')
    .select('*')
    .eq('owner_id', state.user.id)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
};

const fetchFavorites = async () => {
  if (!state.user) return new Set();
  const { data, error } = await client
    .from('favorites')
    .select('song_id')
    .eq('user_id', state.user.id);
  if (error) throw error;
  return new Set((data || []).map(item => item.song_id));
};

const fetchRecent = async () => {
  if (!state.user) return [];
  const { data, error } = await client
    .from('recently_played')
    .select('song_id, played_at, songs(*)')
    .eq('user_id', state.user.id)
    .order('played_at', { ascending: false })
    .limit(30);
  if (error) throw error;
  return data || [];
};

const fetchPlaylists = async () => {
  if (!state.user) return [];
  const { data, error } = await client
    .from('playlists')
    .select('*')
    .eq('owner_id', state.user.id)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
};

const fetchPlaylistTracks = async playlistId => {
  const { data, error } = await client
    .from('playlist_tracks')
    .select('id, position, songs(*)')
    .eq('playlist_id', playlistId)
    .order('position', { ascending: true });
  if (error) throw error;
  return data || [];
};

const signedUrl = async path => {
  const { data, error } = await client.storage.from('user-audio').createSignedUrl(path, 60 * 30);
  if (error) throw error;
  return data?.signedUrl || null;
};

const playSong = async song => {
  if (!song?.audio_path) return;
  const url = await signedUrl(song.audio_path);
  if (!url) return;
  state.currentSong = song;
  state.currentUrl = url;
  qs('#nowTitle').textContent = song.title || 'Untitled';
  qs('#nowSub').textContent = `${song.artist || 'Unknown'} - ${song.album || 'Single'}`;
  audio.src = url;
  await audio.play();
  await client.from('recently_played').insert({
    user_id: state.user.id,
    song_id: song.id,
    source: 'player'
  });
  render();
};

const renderList = items => {
  if (!items.length) return '<div class="row">No data</div>';
  return `
    <div class="list">
      ${items.map(song => `
        <div class="row">
          <div>
            <div>${song.title}</div>
            <div class="meta">${song.artist} - ${song.album}</div>
          </div>
          <div class="actions">
            <button class="btn ghost" data-action="play" data-id="${song.id}">Play</button>
            <button class="btn ghost" data-action="like" data-id="${song.id}">
              ${state.favorites.has(song.id) ? 'Unlike' : 'Like'}
            </button>
            <button class="btn ghost" data-action="queue" data-id="${song.id}">Queue</button>
            <button class="btn ghost" data-action="delete" data-id="${song.id}">Delete</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;
};

const render = async () => {
  setUserUI();
  qs('#viewTitle').textContent = state.view[0].toUpperCase() + state.view.slice(1);

  if (!state.user) {
    qs('#viewContent').innerHTML = '<div class="row">Please login first.</div>';
    return;
  }

  if (state.view === 'library') {
    const filtered = state.songs.filter(song =>
      `${song.title} ${song.artist} ${song.album}`.toLowerCase().includes(state.search.toLowerCase())
    );
    qs('#viewContent').innerHTML = renderList(filtered);
  }

  if (state.view === 'liked') {
    const liked = state.songs.filter(song => state.favorites.has(song.id));
    qs('#viewContent').innerHTML = renderList(liked);
  }

  if (state.view === 'recent') {
    const recentSongs = state.recent.map(item => item.songs).filter(Boolean);
    qs('#viewContent').innerHTML = renderList(recentSongs);
  }

  if (state.view === 'queue') {
    const queued = state.queue.map(id => state.songs.find(song => song.id === id)).filter(Boolean);
    qs('#viewContent').innerHTML = renderList(queued);
  }

  if (state.view === 'playlists') {
    const list = `
      <div class="row">
        <input id="playlistName" placeholder="Playlist name" />
        <button id="createPlaylist" class="btn primary">Create</button>
      </div>
      ${state.playlists.map(pl => `
        <div class="row">
          <div>
            <div>${pl.name}</div>
            <div class="meta">Public: ${pl.is_public ? 'Yes' : 'No'}</div>
          </div>
          <div class="actions">
            <button class="btn ghost" data-action="open-playlist" data-id="${pl.id}">Open</button>
            <button class="btn ghost" data-action="share" data-id="${pl.id}">Share</button>
          </div>
        </div>
      `).join('')}
      <div id="playlistTracks"></div>
    `;
    qs('#viewContent').innerHTML = list;
  }
};

const loadData = async () => {
  state.songs = await fetchSongs();
  state.favorites = await fetchFavorites();
  state.recent = await fetchRecent();
  state.playlists = await fetchPlaylists();
};

const handleUpload = async files => {
  if (!state.user || !files.length) return;
  for (const file of files) {
    const songId = crypto.randomUUID();
    const ext = file.name.split('.').pop() || 'mp3';
    const audioPath = `users/${state.user.id}/songs/${songId}.${ext}`;
    const { error: uploadError } = await client.storage.from('user-audio').upload(audioPath, file, {
      contentType: file.type || 'audio/mpeg'
    });
    if (uploadError) throw uploadError;

    const payload = {
      id: songId,
      owner_id: state.user.id,
      title: file.name.replace(/\.[^/.]+$/, ''),
      artist: 'Unknown Artist',
      album: 'Single',
      audio_path: audioPath,
      size_bytes: file.size,
      mime_type: file.type
    };
    const { error: insertError } = await client.from('songs').insert(payload);
    if (insertError) throw insertError;
  }
  toast('Upload complete');
  await loadData();
  render();
};

const init = async () => {
  const { data } = await client.auth.getSession();
  state.user = data?.session?.user || null;
  await loadData();
  render();
};

qs('#loginBtn').onclick = async () => {
  await client.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin }
  });
};

qs('#logoutBtn').onclick = async () => {
  await client.auth.signOut();
  state.user = null;
  render();
};

qs('#uploadBtn').onclick = async () => {
  const files = Array.from(qs('#fileInput').files || []);
  await handleUpload(files);
};

qs('#searchInput').oninput = e => {
  state.search = e.target.value;
  render();
};

document.addEventListener('click', async e => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const action = btn.dataset.action;
  const id = btn.dataset.id;
  if (!action) return;

  if (action === 'play') {
    const song = state.songs.find(item => item.id === id);
    await playSong(song);
  }
  if (action === 'like') {
    const liked = state.favorites.has(id);
    if (liked) {
      await client.from('favorites').delete().eq('user_id', state.user.id).eq('song_id', id);
    } else {
      await client.from('favorites').insert({ user_id: state.user.id, song_id: id });
    }
    state.favorites = await fetchFavorites();
    render();
  }
  if (action === 'queue') {
    state.queue.push(id);
    localStorage.setItem('kp_queue', JSON.stringify(state.queue));
    render();
  }
  if (action === 'delete') {
    const song = state.songs.find(item => item.id === id);
    if (!song) return;
    await client.storage.from('user-audio').remove([song.audio_path]);
    await client.from('songs').delete().eq('id', id);
    await loadData();
    render();
  }
  if (action === 'open-playlist') {
    const tracks = await fetchPlaylistTracks(id);
    const html = `
      <div class="list">
        ${tracks.map(item => `
          <div class="row">
            <div>
              <div>${item.songs?.title || 'Unknown'}</div>
              <div class="meta">${item.songs?.artist || 'Unknown'} - ${item.songs?.album || 'Single'}</div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
    qs('#playlistTracks').innerHTML = html;
  }
  if (action === 'share') {
    await client.from('playlists').update({ is_public: true }).eq('id', id);
    const link = `${window.location.origin}/#share/${id}`;
    await navigator.clipboard.writeText(link);
    toast(`Share link copied: ${link}`);
    state.playlists = await fetchPlaylists();
    render();
  }
});

qs('#createPlaylist').onclick = async () => {
  const name = qs('#playlistName').value.trim();
  if (!name) return;
  await client.from('playlists').insert({ owner_id: state.user.id, name });
  state.playlists = await fetchPlaylists();
  render();
};

qs('#prevBtn').onclick = () => {
  const idx = state.songs.findIndex(song => song.id === state.currentSong?.id);
  if (idx > 0) playSong(state.songs[idx - 1]);
};

qs('#nextBtn').onclick = () => {
  const idx = state.songs.findIndex(song => song.id === state.currentSong?.id);
  if (idx >= 0 && idx < state.songs.length - 1) playSong(state.songs[idx + 1]);
};

qs('#playBtn').onclick = async () => {
  if (audio.paused) await audio.play();
  else audio.pause();
};

qs('#volume').oninput = e => {
  audio.volume = Number(e.target.value) / 100;
};

qs('#eqBtn').onclick = () => qs('#eqModal').classList.remove('hidden');
qs('#eqClose').onclick = () => qs('#eqModal').classList.add('hidden');
qs('#eqModal').addEventListener('input', e => {
  const input = e.target;
  if (!(input instanceof HTMLInputElement)) return;
  const idx = Number(input.dataset.band);
  if (Number.isNaN(idx)) return;
  bands[idx].gain.value = Number(input.value);
});

document.querySelectorAll('.nav').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.view = btn.dataset.view;
    render();
  });
});

client.auth.onAuthStateChange(async (_event, session) => {
  state.user = session?.user || null;
  await loadData();
  render();
});

window.addEventListener('load', init);
