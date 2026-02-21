// ======= KONFIGURASI SUPABASE =======
const SUPABASE_URL = 'https://nhxjrrfmpeqsgapornxx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5oeGpycmZtcGVxc2dhcG9ybnh4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2NjAyMDcsImV4cCI6MjA4NzIzNjIwN30.qyw6zaXhmIGwPEQR17Bi4c4W7slUUty5Byth3PXEav4';
const SUPABASE_BUCKET = 'songs';
const SUPABASE_TABLE = 'songs';

let supabaseClient = null;
let allSongs = [];
let currentSongIndex = -1;

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
        const globalIndex = allSongs.findIndex(item => item.id === song.id);
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
            <div class="col-action"></div>
        `;

        item.querySelector('.song-name').innerText = song.name;
        item.querySelector('.col-action').innerText = fileType;

        item.onclick = () => playSongByIndex(globalIndex);
        item.querySelector('.play-btn-list').onclick = e => {
            e.stopPropagation();
            playSongByIndex(globalIndex);
        };

        listContainer.appendChild(item);
    });

    highlightCurrentSong();
}

function highlightCurrentSong() {
    const activeId = currentSongIndex >= 0 ? allSongs[currentSongIndex]?.id : null;
    document.querySelectorAll('.song-item').forEach(item => {
        item.classList.toggle('is-playing', Number(item.dataset.songId) === activeId);
    });
}

function playSongByIndex(index) {
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
    player.play().catch(err => console.log('Autoplay dicegah browser:', err));

    playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
    highlightCurrentSong();
}

function togglePlayPause() {
    const player = document.getElementById('audioPlayer');
    const playPauseBtn = document.getElementById('playPauseBtn');

    if (!player.src) {
        if (allSongs.length) playSongByIndex(0);
        return;
    }

    if (player.paused) {
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

async function uploadSong() {
    const fileInput = document.getElementById('fileInput');
    const file = fileInput.files[0];
    const btn = document.getElementById('uploadBtn');

    if (!supabaseClient) {
        setUploadStatus('Config Supabase belum diisi.', '#ff6b6b');
        return;
    }

    if (!file) {
        setUploadStatus('Pilih file dulu.', '#ff6b6b');
        return;
    }

    if (!file.type.startsWith('audio/')) {
        setUploadStatus('File harus audio.', '#ff6b6b');
        return;
    }

    btn.innerText = 'Uploading...';
    btn.disabled = true;
    setUploadStatus('Lagi upload ke Supabase...');

    const safeName = sanitizeFileName(file.name);
    const filePath = `public/${Date.now()}-${safeName}`;

    try {
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

        setUploadStatus('Upload sukses.', '#1DB954');
        fileInput.value = '';
        await loadSongs();

        const uploadedIndex = allSongs.findIndex(song => song.path === filePath);
        if (uploadedIndex >= 0) playSongByIndex(uploadedIndex);
    } catch (error) {
        console.error(error);
        setUploadStatus(`Upload gagal: ${error.message || 'unknown error'}`, '#ff6b6b');
    } finally {
        btn.innerText = 'Upload ke Supabase';
        btn.disabled = false;
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
    const configured = initSupabase();

    if (!configured) {
        document.getElementById('songList').innerHTML = '<p style="color: #ff6b6b; padding: 20px;">Isi `SUPABASE_URL` dan `SUPABASE_ANON_KEY` di script.js.</p>';
        return;
    }

    await loadSongs();
});
