// ======= TARUH URL WEB APP LU DI SINI =======
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz-Kd_DNr-LJUVdDZwvPem0yNVZTaiBtuyQp7fEHmu-rYFt6SaZVmXEmQv6t1oQXmVK/exec'; 

// Array global buat nyimpen data lagu (biar gampang di-search)
let allSongs = [];

// === FUNGSI LOAD LAGU ===
async function loadSongs() {
    const listContainer = document.getElementById('songList');
    try {
        const response = await fetch(APPS_SCRIPT_URL);
        allSongs = await response.json();
        
        renderSongs(allSongs); // Tampilkan ke HTML
        
    } catch (error) {
        listContainer.innerHTML = '<p style="color: red; padding: 20px;">Gagal load lagu. Cek URL atau koneksi.</p>';
        console.error("Error fetching data:", error);
    }
}

// === FUNGSI RENDER KE HTML ===
function renderSongs(songsArray) {
    const listContainer = document.getElementById('songList');
    listContainer.innerHTML = ''; 

    if(songsArray.length === 0) {
        listContainer.innerHTML = '<p style="color: #b3b3b3; padding: 20px;">Kosong bre, atau lagu gak ketemu.</p>';
        return;
    }

    songsArray.forEach((song, index) => {
        const div = document.createElement('div');
        div.className = 'song-item';
        div.innerHTML = `
            <div class="song-title-group">
                <div class="song-icon">
                    <span class="default-icon">${index + 1}</span>
                    <button class="play-btn-list"><i class="fas fa-play"></i></button>
                </div>
                <span class="song-name">${song.name}</span>
            </div>
            <div class="col-action" style="color:#b3b3b3; font-size:12px;">FLAC / Audio</div>
        `;
        
        // Event listener klik buat muter lagu
        div.onclick = () => playSong(song.url, song.name);
        listContainer.appendChild(div);
    });
}

// === FUNGSI PLAY LAGU (YANG UDAH DIPERBAIKI) ===
function playSong(url, name) {
    const player = document.getElementById('audioPlayer');
    const songNameDisplay = document.getElementById('currentSongName');
    
    // Set URL dan NAMA
    player.src = url;
    songNameDisplay.innerText = name;
    
    // FIX PENTING: Panggil load() dulu sebelum play()
    player.load(); 
    
    // Coba otomatis play, tangkap error kalau diblokir
    let playPromise = player.play();
    if (playPromise !== undefined) {
        playPromise.catch(error => {
            console.log("Auto-play dicegah oleh browser, atau file FLAC terlalu besar untuk di-streaming langsung dari Drive tanpa login.", error);
            // Kalau gagal autoplay, biarin usernya mencet tombol play manual di player bawah
        });
    }
}

// === FUNGSI UPLOAD ===
function uploadSong() {
    const fileInput = document.getElementById('fileInput');
    const file = fileInput.files[0];
    const btn = document.getElementById('uploadBtn');
    const status = document.getElementById('uploadStatus');

    if (!file) {
        status.innerText = "Pilih file dulu, King!";
        status.style.color = "red";
        return;
    }

    btn.innerText = "Mikir...";
    btn.disabled = true;
    status.innerText = "Lagi upload ke Drive...";
    status.style.color = "#b3b3b3";

    const reader = new FileReader();
    reader.onload = async function() {
        const base64Data = reader.result.split(',')[1]; 
        
        const payload = {
            fileName: file.name,
            mimeType: file.type,
            base64: base64Data
        };

        try {
            const response = await fetch(APPS_SCRIPT_URL, {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            
            const result = await response.json();
            if(result.status === 'success') {
                status.innerText = "Upload sukses!";
                status.style.color = "#1DB954";
                fileInput.value = ''; 
                loadSongs(); // Refresh daftar otomatis
            } else {
                status.innerText = "Gagal: " + result.message;
            }
        } catch (error) {
            status.innerText = "CORS / Koneksi error.";
            console.error(error);
        } finally {
            btn.innerText = "Upload ke Drive";
            btn.disabled = false;
        }
    };
    
    reader.readAsDataURL(file);
}

// === FUNGSI FITUR SEARCH (DI TENGAH ATAS) ===
function searchLagu() {
    const input = document.getElementById('searchInput').value.toLowerCase();
    // Filter array lagu berdasarkan nama
    const filteredSongs = allSongs.filter(song => song.name.toLowerCase().includes(input));
    renderSongs(filteredSongs);
}

// === FUNGSI NAVIGASI SIDEBAR UI ===
function switchMenu(menuItem) {
    const navItems = document.querySelectorAll('.nav-links li');
    const searchContainer = document.getElementById('searchContainer');
    const pageTitle = document.getElementById('pageTitle');
    
    // Reset warna active
    navItems.forEach(item => item.classList.remove('active'));
    
    if(menuItem === 'home' || menuItem === 'library') {
        event.currentTarget.classList.add('active');
        searchContainer.style.display = 'none';
        pageTitle.innerText = menuItem === 'home' ? 'Your FLAC Collection' : 'Your Library';
        renderSongs(allSongs); // Tampilkan semua
    } 
    else if (menuItem === 'search') {
        event.currentTarget.classList.add('active');
        searchContainer.style.display = 'flex';
        pageTitle.innerText = 'Search Results';
        document.getElementById('searchInput').focus(); // Otomatis ngetik
    }
}

// Load otomatis pas buka
window.onload = loadSongs;
