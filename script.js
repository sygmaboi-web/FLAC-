// ======= KONFIGURASI SUPABASE =======
const SUPABASE_URL = 'https://nhxjrrfmpeqsgapornxx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5oeGpycmZtcGVxc2dhcG9ybnh4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2NjAyMDcsImV4cCI6MjA4NzIzNjIwN30.qyw6zaXhmIGwPEQR17Bi4c4W7slUUty5Byth3PXEav4';
const SUPABASE_BUCKET = 'songs';
const SUPABASE_TABLE = 'songs';

let supabaseClient = null;
let allSongs = [];
let currentSongIndex = -1;

let audioContext = null;
let sourceNode = null;
let bassFilter = null;
let midFilter = null;
let trebleFilter = null;
let outputGain = null;

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

function setUploadStatus(text, color = '#b3b3b3') {
    const status = document.getElementById('uploadStatus');
    status.innerText = text;
    status.style.color = color;
}

function setSelectedFilesText(text) {
    const selectedFilesText = document.getElementById('selectedFilesText');
    selectedFilesText.innerText = text;
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

function initAudioGraph() {
    const player = document.getElementById('audioPlayer');
    if (!player || audioContext) return;

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    audioContext = new AudioContextClass();
    sourceNode = audioContext.createMediaElementSource(player);
    bassFilter = audioContext.createBiquadFilter();
    midFilter = audioContext.createBiquadFilter();
    trebleFilter = audioContext.createBiquadFilter();
    outputGain = audioContext.createGain();

    bassFilter.type = 'lowshelf';
    bassFilter.frequency.value = 160;
    midFilter.type = 'peaking';
    midFilter.frequency.value = 1000;
    midFilter.Q.value = 1;
    trebleFilter.type = 'highshelf';
    trebleFilter.frequency.value = 3500;

    sourceNode.connect(bassFilter);
    bassFilter.connect(midFilter);
    midFilter.connect(trebleFilter);
    trebleFilter.connect(outputGain);
    outputGain.connect(audioContext.destination);
}

function applyEQValues() {
    if (!audioContext || !bassFilter || !midFilter || !trebleFilter || !outputGain) return;

    bassFilter.gain.value = Number(document.getElementById('eqBass').value);
    midFilter.gain.value = Number(document.getElementById('eqMid').value);
    trebleFilter.gain.value = Number(document.getElementById('eqTreble').value);
    outputGain.gain.value = Math.pow(10, Number(document.getElementById('eqGain').value) / 20);

    document.getElementById('eqBassValue').innerText = `${bassFilter.gain.value} dB`;
    document.getElementById('eqMidValue').innerText = `${midFilter.gain.value} dB`;
    document.getElementById('eqTrebleValue').innerText = `${trebleFilter.gain.value} dB`;
    document.getElementById('eqGainValue').innerText = `${document.getElementById('eqGain').value} dB`;
}

function resetEQ() {
    const ids = ['eqBass', 'eqMid', 'eqTreble', 'eqGain'];
    ids.forEach(id => {
        document.getElementById(id).value = '0';
    });
    applyEQValues();
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

function initPlayerBindings() {
    const player = document.getElementById('audioPlayer');
    const playPauseBtn = document.getElementById('playPauseBtn');
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    const seekBar = document.getElementById('seekBar');
    const volumeBar = document.getElementById('volumeBar');
    const fileInput = document.getElementById('fileInput');
    const eqResetBtn = document.getElementById('eqResetBtn');
    const eqSliders = ['eqBass', 'eqMid', 'eqTreble', 'eqGain'];

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

    eqSliders.forEach(id => {
        document.getElementById(id).addEventListener('input', async () => {
            await ensureAudioContextRunning();
            applyEQValues();
        });
    });

    eqResetBtn.addEventListener('click', resetEQ);

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
    resetEQ();
    const configured = initSupabase();

    if (!configured) {
        document.getElementById('songList').innerHTML = '<p style="color: #ff6b6b; padding: 20px;">Isi `SUPABASE_URL` dan `SUPABASE_ANON_KEY` di script.js.</p>';
        return;
    }

    await loadSongs();
});
