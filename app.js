/* global supabase */

// PERBAIKAN URL: Tambah '//' setelah 'https:'
const SUPABASE_URL = 'https://gizslqqltboughqtzwla.supabase.co';
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
  currentContext: [], // Array lagu yang lagi aktif diputer
  search: '',
  view: 'library',
  isShuffle: false,
  repeatMode: 0 // 0: off, 1: all, 2: one
};

// --- Audio Engine ---
const audio = new Audio();
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const source = audioCtx.createMediaElementSource(audio);
const preamp = audioCtx.createGain();

// Frekuensi ala FxSound
const eqFrequencies = [101, 240, 397, 735, 1360, 2520, 4670, 11760, 16000];
const eqLabels = ['101 Hz', '240 Hz', '397 Hz', '735 Hz', '1.36 kHz', '2.52 kHz', '4.67 kHz', '11.7 kHz', '16 kHz'];

let savedEq = JSON.parse(localStorage.getItem('kp_eq_settings') || '[]');

const bands = eqFrequencies.map((freq, i) => {
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'peaking';
  filter.frequency.value = freq;
  filter.Q.value = 1.41;
  filter.gain.value = savedEq[i] || 0;
  return filter;
});

let lastNode = preamp;
bands.forEach(filter => { lastNode.connect(filter); lastNode = filter; });
lastNode.connect(audioCtx.destination);
source.connect(preamp);

// --- Helpers ---
const qs = sel => document.querySelector(sel);
const toast = msg => {
  const el = qs('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3000);
};

// --- Format Time ---
const formatTime = seconds => {
  if (isNaN(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

// --- Knob Logic (FxSound EQ) ---
const renderFxKnobs = () => {
  const container = qs('#fxKnobsContainer');
  container.innerHTML = '';
  
  bands.forEach((band, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'fx-band';
    
    const label = document.createElement('div');
    label.className = 'fx-label';
    label.textContent = eqLabels[i];

    const knobCont = document.createElement('div');
    knobCont.className = 'fx-knob-container';
    
    const pointer = document.createElement('div');
    pointer.className = 'fx-knob-pointer';
    
    const dot = document.createElement('div');
    dot.className = 'fx-knob-dot';
    pointer.appendChild(dot);
    knobCont.appendChild(pointer);

    const valLabel = document.createElement('div');
    valLabel.className = 'fx-value';

    // Update Visuals
    const updateKnob = (value) => {
      // value dari -12 sampai 12. Angle: -135deg to +135deg (diputar dari rotasi awal pointer CSS)
      const angle = (value / 12) * 135; 
      pointer.style.transform = `rotate(${angle - 45}deg)`;
      valLabel.textContent = `${value > 0 ? '+' : ''}${Math.round(value)} dB`;
    };

    let val = savedEq[i] || 0;
    updateKnob(val);

    // Mouse Dragging Logic
    let isDragging = false, startY, startVal;
    
    knobCont.addEventListener('mousedown', e => {
      isDragging = true; startY = e.clientY; startVal = val;
    });

    window.addEventListener('mousemove', e => {
      if (!isDragging) return;
      const deltaY = startY - e.clientY;
      val = Math.max(-12, Math.min(12, startVal + (deltaY * 0.15))); // Sensitivitas
      
      updateKnob(val);
      band.gain.value = val;
      savedEq[i] = val;
    });

    window.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        localStorage.setItem('kp_eq_settings', JSON.stringify(savedEq));
      }
    });

    wrap.appendChild(label);
    wrap.appendChild(knobCont);
    wrap.appendChild(valLabel);
    container.appendChild(wrap);
  });
};

// --- Auth Check ---
const checkAuthAndRenderUI = () => {
  if (state.user) {
    qs('#loginView').classList.add('hidden');
    qs('#mainApp').classList.remove('hidden');
    qs('#userEmail').textContent = state.user.email;
    render();
    renderFxKnobs();
  } else {
    qs('#loginView').classList.remove('hidden');
    qs('#mainApp').classList.add('hidden');
  }
};

// --- Fetch Data ---
const fetchSongs = async () => {
  const { data } = await client.from('songs').select('*').eq('owner_id', state.user.id).order('created_at', { ascending: false });
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

const loadData = async () => {
  if (!state.user) return;
  [state.songs, state.favorites, state.recent] = await Promise.all([ fetchSongs(), fetchFavorites(), fetchRecent() ]);
};

// --- Playback Logic ---
const playSong = async (song, contextList) => {
  if (audioCtx.state === 'suspended') await audioCtx.resume();
  if (!song?.audio_path) return;
  
  if (contextList) state.currentContext = contextList;

  try {
    const { data } = await client.storage.from('user-audio').createSignedUrl(song.audio_path, 60 * 60);
    if (!data?.signedUrl) throw new Error('Failed to get URL');

    state.currentSong = song;
    qs('#nowTitle').textContent = song.title || 'Untitled';
    qs('#nowSub').textContent = song.artist || 'Unknown Artist';
    
    audio.src = data.signedUrl;
    await audio.play();
    
    qs('#playBtn').innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5.7 3a.7.7 0 0 0-.7.7v16.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V3.7a.7.7 0 0 0-.7-.7H5.7zm10 0a.7.7 0 0 0-.7.7v16.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V3.7a.7.7 0 0 0-.7-.7h-2.6z"/></svg>`;
    render(); // Update visual active state
    
    await client.from('recently_played').insert({ user_id: state.user.id, song_id: song.id, source: 'player' });
  } catch (err) {
    toast('Error: Cannot play this audio track.');
    console.error(err);
  }
};

const playNext = () => {
  if (!state.currentSong) return;
  
  // Kalau Loop 1 lagu
  if (state.repeatMode === 2) {
    audio.currentTime = 0;
    audio.play();
    return;
  }

  // Cek antrean (Queue)
  if (state.queue.length > 0) {
    const nextId = state.queue.shift();
    localStorage.setItem('kp_queue', JSON.stringify(state.queue));
    const nextSong = state.songs.find(s => s.id === nextId);
    if (nextSong) { playSong(nextSong, state.currentContext); return; }
  }

  // Cek list reguler
  if (!state.currentContext.length) return;
  let idx = state.currentContext.findIndex(s => s.id === state.currentSong.id);
  
  if (idx !== -1) {
    let nextIdx = idx + 1;
    if (state.isShuffle) nextIdx = Math.floor(Math.random() * state.currentContext.length);
    else if (nextIdx >= state.currentContext.length && state.repeatMode === 1) nextIdx = 0; // Loop All
    
    if (nextIdx < state.currentContext.length) playSong(state.currentContext[nextIdx], state.currentContext);
  }
};

const playPrev = () => {
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  let idx = state.currentContext.findIndex(s => s.id === state.currentSong?.id);
  if (idx > 0) playSong(state.currentContext[idx - 1], state.currentContext);
};

// Event pas lagu kelar
audio.addEventListener('ended', playNext);

// Progress Bar Updates
audio.addEventListener('timeupdate', () => {
  if (audio.duration) {
    qs('#progressBar').value = (audio.currentTime / audio.duration) * 100;
    qs('#timeCurrent').textContent = formatTime(audio.currentTime);
    qs('#timeTotal').textContent = formatTime(audio.duration);
  }
});
qs('#progressBar').oninput = e => {
  if (audio.duration) audio.currentTime = (e.target.value / 100) * audio.duration;
};

// --- Rendering View ---
const renderList = items => {
  if (!items.length) return '<div class="row"><div style="color:var(--text-subdued)">It\'s empty here.</div></div>';
  return `
    <div class="list">
      ${items.map((song, idx) => {
        const isActive = state.currentSong?.id === song.id;
        const isLiked = state.favorites.has(song.id);
        return `
        <div class="row ${isActive ? 'track-active' : ''}">
          <div class="row-num"><span>${idx + 1}</span></div>
          <div>
            <div class="track-name">${song.title}</div>
            <div class="track-meta">${song.artist || 'Unknown Artist'}</div>
          </div>
          <div class="track-meta truncate">${song.album || 'Single'}</div>
          <div class="actions">
            <button class="like-btn ${isLiked ? 'liked' : ''}" data-action="like" data-id="${song.id}">
              ${isLiked ? '♥' : '♡'}
            </button>
            <button class="btn ghost btn-sm" data-action="play" data-id="${song.id}">Play</button>
            <button class="btn ghost btn-sm" data-action="queue" data-id="${song.id}">Add to queue</button>
          </div>
        </div>
      `}).join('')}
    </div>
  `;
};

const render = () => {
  const titles = { library: 'Home', liked: 'Liked Songs', recent: 'Recently Played', queue: 'Play Queue' };
  qs('#viewTitle').textContent = titles[state.view] || 'Library';

  let listToRender = [];
  if (state.view === 'library') {
    listToRender = state.songs.filter(s => `${s.title} ${s.artist}`.toLowerCase().includes(state.search.toLowerCase()));
  } else if (state.view === 'liked') {
    listToRender = state.songs.filter(s => state.favorites.has(s.id));
  } else if (state.view === 'recent') {
    listToRender = state.recent.map(r => r.songs).filter(Boolean);
  } else if (state.view === 'queue') {
    listToRender = state.queue.map(id => state.songs.find(s => s.id === id)).filter(Boolean);
  }
  
  // Store reference to array layout for playback context
  if (state.view !== 'queue') state.viewContext = listToRender;
  
  qs('#viewContent').innerHTML = renderList(listToRender);
};

// --- Global Clicks ---
document.addEventListener('click', async e => {
  if (audioCtx.state === 'suspended') await audioCtx.resume();
  
  const btn = e.target.closest('button');
  if (!btn) return;

  // Navigasi Kiri
  if (btn.classList.contains('nav-item')) {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.view = btn.dataset.view;
    render(); return;
  }

  // EQ Modals FxSound Style
  if (btn.id === 'eqBtn') return qs('#eqModal').classList.remove('hidden');
  if (btn.dataset.action === 'close-eq') return qs('#eqModal').classList.add('hidden');
  if (btn.dataset.action === 'reset-eq') {
    bands.forEach((b, i) => { b.gain.value = 0; savedEq[i] = 0; });
    localStorage.setItem('kp_eq_settings', JSON.stringify(savedEq));
    renderFxKnobs(); return;
  }

  // Actions lagu
  const action = btn.dataset.action;
  const id = btn.dataset.id;
  if (!action || !id) return;

  if (action === 'play') {
    const song = state.songs.find(item => item.id === id);
    await playSong(song, state.viewContext); // Context = list saat ini
  }
  if (action === 'like') {
    // FIX Bug Liked Songs (Database & State)
    if (state.favorites.has(id)) {
      await client.from('favorites').delete().eq('user_id', state.user.id).eq('song_id', id);
      state.favorites.delete(id);
    } else {
      await client.from('favorites').insert({ user_id: state.user.id, song_id: id });
      state.favorites.add(id);
    }
    render();
  }
  if (action === 'queue') {
    state.queue.push(id);
    localStorage.setItem('kp_queue', JSON.stringify(state.queue));
    toast('Added to queue');
  }
});

// --- Player Controls ---
qs('#searchInput').oninput = e => { state.search = e.target.value; render(); };
qs('#volume').oninput = e => { audio.volume = e.target.value / 100; };
qs('#prevBtn').onclick = playPrev;
qs('#nextBtn').onclick = playNext;
qs('#playBtn').onclick = async () => {
  if (audioCtx.state === 'suspended') await audioCtx.resume();
  if (audio.paused && state.currentSong) {
    await audio.play();
    qs('#playBtn').innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5.7 3a.7.7 0 0 0-.7.7v16.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V3.7a.7.7 0 0 0-.7-.7H5.7zm10 0a.7.7 0 0 0-.7.7v16.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V3.7a.7.7 0 0 0-.7-.7h-2.6z"/></svg>`;
  } else {
    audio.pause();
    qs('#playBtn').innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7.05 3.606l13.49 7.788a.7.7 0 0 1 0 1.212L7.05 20.394A.7.7 0 0 1 6 19.788V4.212a.7.7 0 0 1 1.05-.606z"/></svg>`;
  }
};

// Toggle Shuffle
qs('#shuffleBtn').onclick = () => {
  state.isShuffle = !state.isShuffle;
  qs('#shuffleBtn').style.color = state.isShuffle ? 'var(--spotify-green)' : 'var(--text-subdued)';
};
// Toggle Loop (Off -> All -> One)
qs('#loopBtn').onclick = () => {
  state.repeatMode = (state.repeatMode + 1) % 3;
  const btn = qs('#loopBtn');
  if (state.repeatMode === 0) btn.style.color = 'var(--text-subdued)';
  else if (state.repeatMode === 1) btn.style.color = 'var(--spotify-green)';
  else {
    btn.style.color = 'var(--spotify-green)';
    toast('Loop 1 Track Active'); // Kasih tanda ke user kalo ini muter 1 lagu
  }
};

// --- Init ---
const init = async () => {
  const { data } = await client.auth.getSession();
  state.user = data?.session?.user || null;
  if (state.user) await loadData();
  checkAuthAndRenderUI();
};
client.auth.onAuthStateChange(async (_e, session) => {
  state.user = session?.user || null;
  if (state.user) await loadData();
  checkAuthAndRenderUI();
});
qs('#loginBtn').onclick = async () => await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
qs('#logoutBtn').onclick = async () => await client.auth.signOut();
qs('#fileInput').onchange = async e => {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  toast('Uploading...');
  for (const file of files) {
    const songId = crypto.randomUUID();
    const ext = file.name.split('.').pop() || 'mp3';
    const audioPath = `users/${state.user.id}/songs/${songId}.${ext}`;
    await client.storage.from('user-audio').upload(audioPath, file, { contentType: file.type || 'audio/mpeg' });
    await client.from('songs').insert({ id: songId, owner_id: state.user.id, title: file.name.replace(/\.[^/.]+$/, ''), artist: 'Unknown Artist', album: 'Single', audio_path: audioPath });
  }
  toast('Upload complete!'); await loadData(); render();
};

window.addEventListener('load', init);
