/* global supabase */

const SUPABASE_URL = 'https://gizslqqltboughqtzwla.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdpenNscXFsdGJvdWdocXR6d2xhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3MDg3NDcsImV4cCI6MjA4NzI4NDc0N30.CYjSPFKNBmYzugfaO-69RzRPNMq60Tp8uPXlHwg31mQ';

const client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const state = {
  user: null, songs: [], favorites: new Set(), queue: JSON.parse(localStorage.getItem('kp_queue') || '[]'),
  currentSong: null, view: 'library', isShuffle: false, repeatMode: 0, openDropdown: null
};

// --- AUDIO DSP ---
const audio = new Audio();
audio.crossOrigin = "anonymous"; 

let audioCtx = null, analyser = null, dryGain, wetGain, bands = [];
const eqFrequencies = [101, 240, 397, 735, 1360, 2520, 4670, 11760, 16000];
const eqLabels = ['101', '240', '397', '735', '1.3k', '2.5k', '4.6k', '11k', '16k'];

let savedEq = JSON.parse(localStorage.getItem('kp_eq_settings') || '{"gains":[0,0,0,0,0,0,0,0,0],"effects":[0,0,0,0],"isOn":true,"preset":"flat"}');

const initAudioDSP = () => {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const source = audioCtx.createMediaElementSource(audio);
  analyser = audioCtx.createAnalyser(); analyser.fftSize = 256;

  dryGain = audioCtx.createGain(); wetGain = audioCtx.createGain();
  const bass = audioCtx.createBiquadFilter(); bass.type = 'lowshelf'; bass.frequency.value = 80;
  const clarity = audioCtx.createBiquadFilter(); clarity.type = 'highshelf'; clarity.frequency.value = 5000;
  const dynamic = audioCtx.createDynamicsCompressor(); 
  const ambience = audioCtx.createDelay(); ambience.delayTime.value = 0.05;
  const ambGain = audioCtx.createGain();
  const master = audioCtx.createGain();

  bands = eqFrequencies.map((f, i) => {
    const filter = audioCtx.createBiquadFilter(); filter.type = 'peaking'; filter.Q.value = 1.41;
    filter.frequency.value = f; filter.gain.value = savedEq.gains[i]; return filter;
  });

  source.connect(dryGain); dryGain.connect(analyser);
  source.connect(wetGain); wetGain.connect(bass); bass.connect(clarity); clarity.connect(dynamic);
  let last = dynamic; bands.forEach(b => { last.connect(b); last = b; });
  last.connect(master); last.connect(ambience); ambience.connect(ambGain); ambGain.connect(master);
  master.connect(analyser); analyser.connect(audioCtx.destination);
  
  window.bassNode = bass; window.clarityNode = clarity; window.dynamicNode = dynamic;
  window.ambGainNode = ambGain; window.dryGain = dryGain; window.wetGain = wetGain;
  
  applyDSP(); drawHistogram();
};

const applyDSP = () => {
  if (!audioCtx) return;
  window.dryGain.gain.value = savedEq.isOn ? 0 : 1;
  window.wetGain.gain.value = savedEq.isOn ? 1 : 0;
  window.clarityNode.gain.value = (savedEq.effects[0] / 100) * 15;
  window.ambGainNode.gain.value = (savedEq.effects[1] / 100) * 0.5;
  window.dynamicNode.ratio.value = 1 + (savedEq.effects[2] / 100) * 10;
  window.bassNode.gain.value = (savedEq.effects[3] / 100) * 15;
  bands.forEach((b, i) => b.gain.value = savedEq.gains[i]);
};

function drawHistogram() {
  requestAnimationFrame(drawHistogram);
  if (!analyser || document.getElementById('eqModal').classList.contains('hidden')) return;
  const canvas = document.getElementById('histogram'); const ctx = canvas.getContext('2d');
  const data = new Uint8Array(analyser.frequencyBinCount); analyser.getByteFrequencyData(data);
  ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0,0,canvas.width,canvas.height);
  const bw = (canvas.width / data.length) * 2.5; let x = 0;
  for(let i=0; i<data.length; i++) {
    const bh = data[i] / 2; ctx.fillStyle = savedEq.isOn ? `rgb(${bh+100},40,70)` : '#444';
    ctx.fillRect(x, canvas.height-bh, bw, bh); x += bw + 1;
  }
}

// --- UTILS ---
const qs = sel => document.querySelector(sel);
const cleanPath = p => p.replace('user-audio/', '');
const formatTime = s => { if(!s || isNaN(s)) return '0:00'; const m=Math.floor(s/60); const sec=Math.floor(s%60); return `${m}:${sec.toString().padStart(2,'0')}`; };

const playSong = async (song, context) => {
  initAudioDSP(); if(audioCtx.state === 'suspended') await audioCtx.resume();
  if(!song) return; state.currentContext = context || state.songs;
  try {
    const { data } = client.storage.from('user-audio').getPublicUrl(cleanPath(song.audio_path));
    state.currentSong = song;
    qs('#nowTitle').textContent = song.title; qs('#nowSub').textContent = song.artist || 'Unknown';
    audio.src = data.publicUrl; await audio.play();
    qs('#playBtn').innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5.7 3a.7.7 0 0 0-.7.7v16.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V3.7a.7.7 0 0 0-.7-.7H5.7zm10 0a.7.7 0 0 0-.7.7v16.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V3.7a.7.7 0 0 0-.7-.7h-2.6z"/></svg>`;
    render();
  } catch (err) { console.error(err); }
};

const renderEq = () => {
  const cont = qs('#eqSlidersContainer'); if(!cont) return;
  cont.innerHTML = eqFrequencies.map((f, i) => `
    <div class="eq-band">
      <div class="eq-val">${Math.round(savedEq.gains[i])}dB</div>
      <div class="eq-slider-container">
        <div class="eq-grid">${'<div class="eq-grid-line"></div>'.repeat(5)}</div>
        <input type="range" class="eq-range" min="-12" max="12" step="0.1" value="${savedEq.gains[i]}" data-idx="${i}" ${!savedEq.isOn ? 'disabled':''}>
      </div>
      <div class="eq-hz">${eqLabels[i]}</div>
    </div>
  `).join('');
  cont.querySelectorAll('.eq-range').forEach(r => r.oninput = e => {
    savedEq.gains[e.target.dataset.idx] = Number(e.target.value);
    savedEq.preset = 'custom'; localStorage.setItem('kp_eq_settings', JSON.stringify(savedEq)); applyDSP();
    e.target.closest('.eq-band').querySelector('.eq-val').textContent = Math.round(e.target.value) + 'dB';
  });
};

document.addEventListener('click', async e => {
  const btn = e.target.closest('button');
  if (btn?.id === 'eqToggleBtn') {
    savedEq.isOn = !savedEq.isOn;
    btn.textContent = savedEq.isOn ? 'ON' : 'OFF'; btn.classList.toggle('off', !savedEq.isOn);
    localStorage.setItem('kp_eq_settings', JSON.stringify(savedEq)); applyDSP(); renderEq();
    return;
  }
  if (btn?.id === 'eqBtn') qs('#eqModal').classList.remove('hidden');
  if (btn?.dataset.action === 'close-eq') qs('#eqModal').classList.add('hidden');

  // Handle Song List Clicks
  const row = e.target.closest('.row');
  if (row && !e.target.closest('.actions-cell')) {
    const s = state.songs.find(x => x.id === row.dataset.id);
    playSong(s);
  }
});

// --- INIT ---
const init = async () => {
  const { data } = await client.auth.getSession(); state.user = data?.session?.user || null;
  if (state.user) {
    const { data: s } = await client.from('songs').select('*').eq('owner_id', state.user.id);
    state.songs = s || [];
    qs('#loginView').classList.add('hidden'); qs('#mainApp').classList.remove('hidden');
    qs('#userEmail').textContent = state.user.email; render(); renderEq();
  }
};
init();
qs('#loginBtn').onclick = () => client.auth.signInWithOAuth({provider:'google'});
qs('#logoutBtn').onclick = () => client.auth.signOut();
audio.ontimeupdate = () => { if(audio.duration){ qs('#progressBar').value = (audio.currentTime/audio.duration)*100; qs('#timeCurrent').textContent = formatTime(audio.currentTime); qs('#timeTotal').textContent = formatTime(audio.duration); } };
qs('#progressBar').oninput = e => { audio.currentTime = (e.target.value/100)*audio.duration; };
