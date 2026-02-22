/* global supabase */

const SUPABASE_URL = 'https://gizslqqltboughqtzwla.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdpenNscXFsdGJvdWdocXR6d2xhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3MDg3NDcsImV4cCI6MjA4NzI4NDc0N30.CYjSPFKNBmYzugfaO-69RzRPNMq60Tp8uPXlHwg31mQ';

const client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const state = {
  user: null, songs: [], favorites: new Set(), recent: [], playlists: [],
  queue: JSON.parse(localStorage.getItem('kp_queue') || '[]'),
  currentSong: null, currentUrl: null, currentContext: [], search: '', view: 'library',
  isShuffle: false, repeatMode: 0, openDropdown: null
};

// --- Advanced Audio DSP Engine (Tanpa crossOrigin biar gak error CORS) ---
const audio = new Audio();
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const source = audioCtx.createMediaElementSource(audio);

const bassNode = audioCtx.createBiquadFilter(); bassNode.type = 'lowshelf'; bassNode.frequency.value = 80;
const clarityNode = audioCtx.createBiquadFilter(); clarityNode.type = 'highshelf'; clarityNode.frequency.value = 5000;
const dynamicNode = audioCtx.createDynamicsCompressor(); dynamicNode.threshold.value = -24; dynamicNode.ratio.value = 1;
const ambienceNode = audioCtx.createDelay(); ambienceNode.delayTime.value = 0.05;
const ambienceGain = audioCtx.createGain(); ambienceGain.gain.value = 0;
const masterGain = audioCtx.createGain();

const eqFrequencies = [101, 240, 397, 735, 1360, 2520, 4670, 11760, 16000];

// Handle LocalStorage format lama
let savedEq;
try {
  savedEq = JSON.parse(localStorage.getItem('kp_eq_settings'));
  if (!savedEq || !savedEq.gains) throw new Error("Format lama");
} catch (e) {
  savedEq = {
    "gains": [0,0,0,0,0,0,0,0,0],
    "hz": [101,240,397,735,1360,2520,4670,11760,16000],
    "effects": [0,0,0,0]
  };
  localStorage.setItem('kp_eq_settings', JSON.stringify(savedEq));
}

const bands = eqFrequencies.map((freq, i) => {
  const filter = audioCtx.createBiquadFilter(); filter.type = 'peaking'; filter.Q.value = 1.41;
  filter.frequency.value = savedEq.hz[i]; filter.gain.value = savedEq.gains[i];
  return filter;
});

// Routing
source.connect(bassNode);
bassNode.connect(clarityNode);
clarityNode.connect(dynamicNode);
let lastNode = dynamicNode;
bands.forEach(filter => { lastNode.connect(filter); lastNode = filter; });
lastNode.connect(masterGain);
lastNode.connect(ambienceNode);
ambienceNode.connect(ambienceGain);
ambienceGain.connect(masterGain);
masterGain.connect(audioCtx.destination);

const applyEffects = () => {
  document.getElementById('fxClarity').value = savedEq.effects[0];
  document.getElementById('fxAmbience').value = savedEq.effects[1];
  document.getElementById('fxDynamic').value = savedEq.effects[2];
  document.getElementById('fxBass').value = savedEq.effects[3];
  
  clarityNode.gain.value = (savedEq.effects[0] / 100) * 15;
  ambienceGain.gain.value = (savedEq.effects[1] / 100) * 0.5;
  dynamicNode.ratio.value = 1 + ((savedEq.effects[2] / 100) * 10);
  bassNode.gain.value = (savedEq.effects[3] / 100) * 15;
};

window.addEventListener('load', () => applyEffects());

const qs = sel => document.querySelector(sel);
const toast = msg => { const el = qs('#toast'); el.textContent = msg; el.classList.remove('hidden'); setTimeout(() => el.classList.add('hidden'), 3000); };
const formatTime = seconds => { if (isNaN(seconds)) return '0:00'; const m = Math.floor(seconds / 60); const s = Math.floor(seconds % 60); return `${m}:${s.toString().padStart(2, '0')}`; };

const renderFxGraph = () => {
  const container = qs('#eqGraphContainer');
  const w = container.clientWidth || 600; const h = 200;
  
  let points = savedEq.gains.map((gain, i) => ({ x: (w / 10) * (i + 1), y: h / 2 - (gain * (h / 24)) }));

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute('class', 'fx-line');
  svg.appendChild(path);

  const drawPath = () => {
    let d = `M 0 ${h/2} `;
    points.forEach(p => d += `L ${p.x} ${p.y} `);
    d += `L ${w} ${h/2}`;
    path.setAttribute('d', d);
  };

  points.forEach((p, i) => {
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute('cx', p.x); circle.setAttribute('cy', p.y);
    circle.setAttribute('r', 6); circle.setAttribute('class', 'fx-node');
    
    let isDragging = false;
    circle.addEventListener('mousedown', () => isDragging = true);
    window.addEventListener('mousemove', e => {
      if (!isDragging) return;
      const rect = container.getBoundingClientRect();
      let newY = e.clientY - rect.top;
      newY = Math.max(10, Math.min(h - 10, newY)); 
      circle.setAttribute('cy', newY); points[i].y = newY; drawPath();
      
      let gain = ((h/2 - newY) / (h/2)) * 12;
      bands[i].gain.value = gain; savedEq.gains[i] = gain;
    });
    window.addEventListener('mouseup', () => {
      if (isDragging) { isDragging = false; localStorage.setItem('kp_eq_settings', JSON.stringify(savedEq)); }
    });
    svg.appendChild(circle);
  });
  
  drawPath(); container.innerHTML = ''; container.appendChild(svg);
};

const renderFxKnobs = () => {
  const container = qs('#fxKnobsContainer'); container.innerHTML = '';
  bands.forEach((band, i) => {
    const wrap = document.createElement('div'); wrap.className = 'fx-band';
    const label = document.createElement('div'); label.className = 'fx-label'; label.textContent = 'Hz';
    const knobCont = document.createElement('div'); knobCont.className = 'fx-knob-container';
    const pointer = document.createElement('div'); pointer.className = 'fx-knob-pointer';
    knobCont.appendChild(pointer);
    const valLabel = document.createElement('div'); valLabel.className = 'fx-value';
    
    const updateKnob = (val) => {
      valLabel.textContent = Math.round(val);
      pointer.style.transform = `rotate(${(val / 20000) * 270 - 45}deg)`;
    };
    updateKnob(savedEq.hz[i]);

    let isDragging = false, startY, startVal;
    knobCont.addEventListener('mousedown', e => { isDragging = true; startY = e.clientY; startVal = savedEq.hz[i]; });
    window.addEventListener('mousemove', e => {
      if (!isDragging) return;
      let val = startVal + (startY - e.clientY) * 50; 
      val = Math.max(20, Math.min(20000, val)); 
      updateKnob(val); band.frequency.value = val; savedEq.hz[i] = val;
    });
    window.addEventListener('mouseup', () => {
      if (isDragging) { isDragging = false; localStorage.setItem('kp_eq_settings', JSON.stringify(savedEq)); }
    });
    wrap.append(label, knobCont, valLabel); container.appendChild(wrap);
  });
};

document.querySelectorAll('.fx-left-panel input').forEach((input, i) => {
  input.addEventListener('input', e => {
    let val = Number(e.target.value);
    savedEq.effects[i] = val; applyEffects(); localStorage.setItem('kp_eq_settings', JSON.stringify(savedEq));
  });
});

const loadData = async () => {
  if (!state.user) return;
  const [{ data: s }, { data: f }, { data: r }] = await Promise.all([
    client.from('songs').select('*').eq('owner_id', state.user.id).order('created_at', { ascending: false }),
    client.from('favorites').select('song_id').eq('user_id', state.user.id),
    client.from('recently_played').select('song_id, played_at, songs(*)').eq('user_id', state.user.id).order('played_at', { ascending: false }).limit(30)
  ]);
  state.songs = s || []; state.favorites = new Set((f || []).map(item => item.song_id)); state.recent = r || [];
};

// --- FIX: BLOB DOWNLOAD METHOD BIAR GAK ERROR CORS ---
const playSong = async (song, contextList) => {
  if (audioCtx.state === 'suspended') await audioCtx.resume();
  if (!song?.audio_path) return;
  if (contextList) state.currentContext = contextList;

  try {
    toast('Loading audio buffer... 🎧');
    
    const { data, error } = await client.storage.from('user-audio').download(song.audio_path);
    if (error) throw error;
    
    if (state.currentUrl) URL.revokeObjectURL(state.currentUrl);
    const url = URL.createObjectURL(data);
    state.currentUrl = url;

    state.currentSong = song;
    qs('#nowTitle').textContent = song.title; qs('#nowSub').textContent = song.artist || 'Unknown';
    audio.src = url; 
    await audio.play();
    
    qs('#playBtn').innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5.7 3a.7.7 0 0 0-.7.7v16.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V3.7a.7.7 0 0 0-.7-.7H5.7zm10 0a.7.7 0 0 0-.7.7v16.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V3.7a.7.7 0 0 0-.7-.7h-2.6z"/></svg>`;
    render();
    await client.from('recently_played').insert({ user_id: state.user.id, song_id: song.id, source: 'player' });
  } catch (err) { toast('Gagal muter lagu. Cek konsol atau koneksi internet.'); console.error(err); }
};

const playNext = () => {
  if (!state.currentSong) return;
  if (state.repeatMode === 2) { audio.currentTime = 0; audio.play(); return; }
  if (state.queue.length > 0) {
    const nextId = state.queue.shift(); localStorage.setItem('kp_queue', JSON.stringify(state.queue));
    const nextSong = state.songs.find(s => s.id === nextId);
    if (nextSong) { playSong(nextSong, state.currentContext); return; }
  }
  let idx = state.currentContext.findIndex(s => s.id === state.currentSong.id);
  if (idx !== -1) {
    let nextIdx = state.isShuffle ? Math.floor(Math.random() * state.currentContext.length) : idx + 1;
    if (nextIdx >= state.currentContext.length && state.repeatMode === 1) nextIdx = 0;
    if (nextIdx < state.currentContext.length) playSong(state.currentContext[nextIdx], state.currentContext);
  }
};
audio.addEventListener('ended', playNext);
const playPrev = () => {
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  let idx = state.currentContext.findIndex(s => s.id === state.currentSong?.id);
  if (idx > 0) playSong(state.currentContext[idx - 1], state.currentContext);
};

audio.addEventListener('timeupdate', () => {
  if (audio.duration) {
    qs('#progressBar').value = (audio.currentTime / audio.duration) * 100;
    qs('#timeCurrent').textContent = formatTime(audio.currentTime);
    qs('#timeTotal').textContent = formatTime(audio.duration);
  }
});

const renderList = items => {
  if (!items.length) return '<div class="row" style="color:var(--text-subdued)">Kosong nih, upload lagu dulu.</div>';
  return items.map((song, idx) => {
    const isActive = state.currentSong?.id === song.id;
    const isLiked = state.favorites.has(song.id);
    const dur = song.duration_seconds ? formatTime(song.duration_seconds) : '--:--';
    return `
      <div class="row ${isActive ? 'track-active' : ''}" data-id="${song.id}">
        <div class="row-num"><span>${idx + 1}</span></div>
        <div class="track-info-cell">
          <div class="track-name">${song.title}</div>
          <div class="track-meta">${song.artist || 'Unknown'}</div>
        </div>
        <div class="track-meta truncate">${song.album || 'Single'}</div>
        <div class="actions-cell">
          <button class="plus-btn ${isLiked ? 'liked' : ''}" data-action="like" data-id="${song.id}">
            <svg viewBox="0 0 16 16" fill="currentColor"><path d="${isLiked ? 'M8 1.314C12.438-3.248 23.534 4.735 8 15-7.534 4.736 3.562-3.248 8 1.314z' : 'M8 2.748l-.717-.737C5.6.281 2.514.878 1.4 3.053c-.523 1.023-.641 2.5.314 4.385.92 1.815 2.834 3.989 6.286 6.357 3.452-2.368 5.365-4.542 6.286-6.357.955-1.886.838-3.362.314-4.385C13.486.878 10.4.28 8.717 2.01L8 2.748zM8 15C-7.333 4.868 3.279-3.04 7.824 1.143c.06.055.119.112.176.171a3.12 3.12 0 0 1 .176-.17C12.72-3.042 23.333 4.867 8 15z'}"/></svg>
          </button>
          <div class="duration-text">${dur}</div>
          <div style="position:relative;">
            <button class="dots-btn" data-action="options" data-id="${song.id}">
              <svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 8a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm6.5 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zM16 8a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z"/></svg>
            </button>
            <div id="drop-${song.id}" class="dropdown">
              <button class="dropdown-item" data-action="queue" data-id="${song.id}">Add to Queue</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
};

const render = () => {
  const titles = { library: 'Home', liked: 'Liked Songs', playlists: 'Playlists', queue: 'Play Queue' };
  qs('#viewTitle').textContent = titles[state.view] || 'Library';

  let list = [];
  if (state.view === 'library') list = state.songs.filter(s => `${s.title} ${s.artist}`.toLowerCase().includes(state.search.toLowerCase()));
  else if (state.view === 'liked') list = state.songs.filter(s => state.favorites.has(s.id));
  else if (state.view === 'queue') list = state.queue.map(id => state.songs.find(s => s.id === id)).filter(Boolean);
  
  if (state.view !== 'queue') state.viewContext = list;
  qs('#viewContent').innerHTML = renderList(list);
};

document.addEventListener('click', async e => {
  if (audioCtx.state === 'suspended') await audioCtx.resume();
  
  if (!e.target.closest('.dots-btn') && state.openDropdown) {
    state.openDropdown.classList.remove('show'); state.openDropdown = null;
  }

  const btn = e.target.closest('button');
  if (!btn) {
    const row = e.target.closest('.row');
    if (row && !e.target.closest('.actions-cell')) {
      const song = state.songs.find(s => s.id === row.dataset.id);
      if (song) playSong(song, state.viewContext);
    }
    return;
  }

  if (btn.id === 'bigPlayBtn') {
    if (state.viewContext.length) playSong(state.viewContext[0], state.viewContext);
    return;
  }
  if (btn.classList.contains('nav-item')) {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active'); state.view = btn.dataset.view; render(); return;
  }

  if (btn.id === 'eqBtn') { renderFxGraph(); renderFxKnobs(); qs('#eqModal').classList.remove('hidden'); return; }
  if (btn.dataset.action === 'close-eq') return qs('#eqModal').classList.add('hidden');
  
  const action = btn.dataset.action; const id = btn.dataset.id;
  if (!action) return;

  if (action === 'like') {
    if (state.favorites.has(id)) { await client.from('favorites').delete().eq('user_id', state.user.id).eq('song_id', id); state.favorites.delete(id); }
    else { await client.from('favorites').insert({ user_id: state.user.id, song_id: id }); state.favorites.add(id); toast('Added to Liked Songs'); }
    render();
  }
  if (action === 'options') {
    if (state.openDropdown) state.openDropdown.classList.remove('show');
    const drop = document.getElementById(`drop-${id}`);
    if (drop) { drop.classList.add('show'); state.openDropdown = drop; }
  }
  if (action === 'queue') {
    state.queue.push(id); localStorage.setItem('kp_queue', JSON.stringify(state.queue));
    toast('Added to Queue'); if(state.openDropdown) state.openDropdown.classList.remove('show');
  }
});

qs('#playBtn').onclick = async () => {
  if (audioCtx.state === 'suspended') await audioCtx.resume();
  if (audio.paused && state.currentSong) { await audio.play(); qs('#playBtn').innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5.7 3a.7.7 0 0 0-.7.7v16.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V3.7a.7.7 0 0 0-.7-.7H5.7zm10 0a.7.7 0 0 0-.7.7v16.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V3.7a.7.7 0 0 0-.7-.7h-2.6z"/></svg>`; }
  else { audio.pause(); qs('#playBtn').innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7.05 3.606l13.49 7.788a.7.7 0 0 1 0 1.212L7.05 20.394A.7.7 0 0 1 6 19.788V4.212a.7.7 0 0 1 1.05-.606z"/></svg>`; }
};
qs('#prevBtn').onclick = playPrev; qs('#nextBtn').onclick = playNext;
qs('#progressBar').oninput = e => { if (audio.duration) audio.currentTime = (e.target.value / 100) * audio.duration; };
qs('#volume').oninput = e => masterGain.gain.value = e.target.value / 100;

const checkAuthAndRenderUI = () => {
  if (state.user) { qs('#loginView').classList.add('hidden'); qs('#mainApp').classList.remove('hidden'); qs('#userEmail').textContent = state.user.email; render(); }
  else { qs('#loginView').classList.remove('hidden'); qs('#mainApp').classList.add('hidden'); }
};

const init = async () => {
  const { data } = await client.auth.getSession(); state.user = data?.session?.user || null;
  if (state.user) await loadData(); checkAuthAndRenderUI();
};
qs('#loginBtn').onclick = async () => await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
qs('#logoutBtn').onclick = async () => await client.auth.signOut();
window.addEventListener('load', init);
