import { mount } from '../lib/dom.js';
import { formatTime } from '../utils/format.js';

const NAV_ITEMS = [
  { key: 'home', label: 'Home', icon: 'fa-home' },
  { key: 'library', label: 'Library', icon: 'fa-music' },
  { key: 'liked', label: 'Liked', icon: 'fa-heart' },
  { key: 'recent', label: 'Recent', icon: 'fa-clock-rotate-left' },
  { key: 'playlists', label: 'Playlists', icon: 'fa-list' },
  { key: 'queue', label: 'Queue', icon: 'fa-grip-lines' }
];

const EQ_FREQ_LABELS = ['101 Hz', '240 Hz', '397 Hz', '735 Hz', '1.36 kHz', '2.52 kHz', '4.67 kHz', '11.76 kHz', '16.00 kHz'];

const toSafeCoverInitial = text => {
  const safe = String(text || '').trim();
  return safe ? safe.charAt(0).toUpperCase() : 'M';
};

const coverArtwork = (song, sizeClass = 'cover-md') => {
  if (song?.cover_signed_url) {
    return `<img class="song-cover ${sizeClass}" src="${song.cover_signed_url}" alt="Cover ${song.title || 'song'}" loading="lazy">`;
  }

  return `<div class="song-cover ${sizeClass} song-cover-fallback">${toSafeCoverInitial(song?.title)}</div>`;
};

const emptyState = message => `<div class="empty-state">${message}</div>`;

const songCard = ({
  song,
  isLiked = false,
  showAddPlaylist = false,
  playlists = [],
  showPlaylistControls = false,
  playlistTrackId = null,
  playlistId = null,
  canMoveUp = false,
  canMoveDown = false
}) => {
  if (!song) {
    return `<div class="song-row"><div class="song-main"><div><div class="song-title">Song unavailable</div></div></div></div>`;
  }

  const durationLabel = Number.isFinite(Number(song.duration_seconds)) ? formatTime(Number(song.duration_seconds)) : '--:--';

  return `
    <div class="song-row" data-song-id="${song.id}">
      <div class="song-main">
        ${coverArtwork(song)}
        <button class="icon-btn" data-action="play-song" data-song-id="${song.id}">
          <i class="fas fa-play"></i>
        </button>
        <div>
          <div class="song-title">${song.title}</div>
          <div class="song-sub">${song.artist} - ${song.album}</div>
        </div>
      </div>
      <div class="song-meta">${durationLabel}</div>
      <div class="song-actions">
        <button class="icon-btn" data-action="play-next" data-song-id="${song.id}" title="Play Next">
          <i class="fas fa-forward"></i>
        </button>
        <button class="icon-btn ${isLiked ? 'is-active' : ''}" data-action="toggle-like" data-song-id="${song.id}">
          <i class="fas fa-heart"></i>
        </button>
        <button class="icon-btn" data-action="add-queue" data-song-id="${song.id}">
          <i class="fas fa-plus"></i>
        </button>
        ${
          showAddPlaylist
            ? `
          <select data-action="add-to-playlist" data-song-id="${song.id}">
            <option value="">Add to playlist...</option>
            ${playlists.map(playlist => `<option value="${playlist.id}">${playlist.name}</option>`).join('')}
          </select>
        `
            : ''
        }
        ${
          showPlaylistControls
            ? `
          <button class="icon-btn" data-action="move-playlist-track-up" data-playlist-id="${playlistId}" data-track-id="${playlistTrackId}" ${canMoveUp ? '' : 'disabled'} title="Move Up">
            <i class="fas fa-arrow-up"></i>
          </button>
          <button class="icon-btn" data-action="move-playlist-track-down" data-playlist-id="${playlistId}" data-track-id="${playlistTrackId}" ${canMoveDown ? '' : 'disabled'} title="Move Down">
            <i class="fas fa-arrow-down"></i>
          </button>
          <button class="icon-btn danger" data-action="remove-playlist-track" data-playlist-id="${playlistId}" data-track-id="${playlistTrackId}" title="Remove from Playlist">
            <i class="fas fa-xmark"></i>
          </button>
        `
            : ''
        }
        <button class="icon-btn danger" data-action="delete-song" data-song-id="${song.id}">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    </div>
  `;
};

const noticeItem = notice => `
  <div class="notice notice-${notice.type}">
    <span>${notice.text}</span>
    <button class="icon-btn" data-action="dismiss-notice" data-notice-id="${notice.id}">
      <i class="fas fa-xmark"></i>
    </button>
  </div>
`;

const eqSliders = eqState => {
  return eqState.bands
    .map(
      (band, index) => `
      <label class="eq-band">
        ${EQ_FREQ_LABELS[index]}
        <input type="range" min="-12" max="12" step="0.5" value="${band}" data-action="eq-band" data-band-index="${index}">
        <span>${Number(band).toFixed(1)} dB</span>
      </label>
    `
    )
    .join('');
};

export const renderAppView = ({ root, state, handlers }) => {
  const currentView = state.view;
  const fullLibrary = state.library || [];
  const library = state.filteredLibrary || fullLibrary;
  const favoriteIds = new Set((state.favorites || []).map(item => item.song_id));
  const likedSongs = library.filter(song => favoriteIds.has(song.id));
  const recentSongs = Array.from(
    (state.recentlyPlayed || []).reduce((acc, item) => {
      if (item?.songs?.id && !acc.has(item.songs.id)) acc.set(item.songs.id, item.songs);
      return acc;
    }, new Map()).values()
  );
  const queueSongs = state.queue || [];
  const activePlaylistId = state.activePlaylistId || (state.playlists[0]?.id ?? null);
  const activePlaylist = (state.playlists || []).find(item => item.id === activePlaylistId) || null;
  const activePlaylistTracks = activePlaylistId ? state.playlistTracks[activePlaylistId] || [] : [];
  const nowPlaying = fullLibrary.find(song => song.id === state.player.currentSongId) || null;

  const renderView = () => {
    if (currentView === 'home') {
      return `
        <section class="view-home">
          <div class="stats-grid">
            <div class="stat-card"><p>Total Lagu</p><h3>${library.length}</h3></div>
            <div class="stat-card"><p>Favorites</p><h3>${likedSongs.length}</h3></div>
            <div class="stat-card"><p>Playlist</p><h3>${state.playlists.length}</h3></div>
          </div>
          <h2>Recently Added</h2>
          <div class="song-list">
            ${
              library.length
                ? library
                    .slice(0, 8)
                    .map(song => songCard({ song, isLiked: favoriteIds.has(song.id), playlists: state.playlists, showAddPlaylist: true }))
                    .join('')
                : emptyState('Belum ada lagu di library. Upload audio dulu.')
            }
          </div>
        </section>
      `;
    }

    if (currentView === 'liked') {
      return `
        <section>
          <h2>Liked Songs</h2>
          <div class="song-list">
            ${likedSongs.length
              ? likedSongs.map(song => songCard({ song, isLiked: true, playlists: state.playlists, showAddPlaylist: true })).join('')
              : emptyState('Belum ada lagu yang kamu like.')}
          </div>
        </section>
      `;
    }

    if (currentView === 'recent') {
      return `
        <section>
          <h2>Recently Played</h2>
          <div class="song-list">
            ${recentSongs.length
              ? recentSongs.map(song => songCard({ song, isLiked: favoriteIds.has(song.id), playlists: state.playlists, showAddPlaylist: true })).join('')
              : emptyState('Belum ada riwayat lagu diputar.')}
          </div>
        </section>
      `;
    }

    if (currentView === 'queue') {
      return `
        <section>
          <h2>Playback Queue</h2>
          <div class="queue-list">
            ${
              queueSongs.length
                ? queueSongs
                    .map(
                      (item, index) => `
                <div class="queue-item">
                  <div class="queue-main">
                    ${coverArtwork(item.songs)}
                    <div>
                      <div class="song-title">${item.songs?.title || 'Unknown song'}</div>
                      <div class="song-sub">${item.songs?.artist || 'Unknown Artist'} - ${item.songs?.album || 'Single'}</div>
                    </div>
                  </div>
                  <div>
                  <div class="queue-actions">
                    <button class="icon-btn" data-action="move-queue-up" data-queue-id="${item.id}" ${index > 0 ? '' : 'disabled'}><i class="fas fa-arrow-up"></i></button>
                    <button class="icon-btn" data-action="move-queue-down" data-queue-id="${item.id}" ${
                        index < queueSongs.length - 1 ? '' : 'disabled'
                      }><i class="fas fa-arrow-down"></i></button>
                    <button class="icon-btn" data-action="play-song" data-song-id="${item.song_id}"><i class="fas fa-play"></i></button>
                    <button class="icon-btn danger" data-action="remove-queue" data-queue-id="${item.id}"><i class="fas fa-trash"></i></button>
                  </div>
                </div>
              `
                    )
                    .join('')
                : emptyState('Queue masih kosong. Klik tombol Add to Queue atau Play Next.')
            }
          </div>
        </section>
      `;
    }

    if (currentView === 'playlists') {
      return `
        <section class="playlist-view">
          <div class="playlist-side">
            <h2>Your Playlists</h2>
            <div class="playlist-create">
              <input type="text" id="newPlaylistName" placeholder="Playlist name">
              <button class="btn btn-primary" data-action="create-playlist">Create</button>
            </div>
            <div class="playlist-items">
              ${
                (state.playlists || []).length
                  ? (state.playlists || [])
                      .map(
                        playlist => `
                  <button
                    class="playlist-item ${activePlaylistId === playlist.id ? 'active' : ''}"
                    data-action="select-playlist"
                    data-playlist-id="${playlist.id}">
                    ${playlist.name}
                  </button>
                `
                      )
                      .join('')
                  : emptyState('Belum ada playlist.')
              }
            </div>
          </div>
          <div class="playlist-main">
            ${
              activePlaylist
                ? `
                <div class="playlist-head">
                  <h3>${activePlaylist.name}</h3>
                  <div class="playlist-head-actions">
                    <label class="playlist-public-toggle">
                      <input type="checkbox" data-action="toggle-playlist-public" data-playlist-id="${activePlaylist.id}" ${activePlaylist.is_public ? 'checked' : ''}>
                      <span>Public Metadata</span>
                    </label>
                    <button class="btn btn-outline" data-action="share-playlist" data-playlist-id="${activePlaylist.id}">
                      Share
                    </button>
                    <button class="btn btn-ghost" data-action="delete-playlist" data-playlist-id="${activePlaylist.id}">
                      Delete
                    </button>
                  </div>
                </div>
                <div class="song-list">
                  ${
                    activePlaylistTracks.length
                      ? activePlaylistTracks
                          .map((item, index) =>
                            songCard({
                              song: item.songs,
                              isLiked: favoriteIds.has(item.song_id),
                              playlists: state.playlists,
                              showAddPlaylist: false,
                              showPlaylistControls: true,
                              playlistTrackId: item.id,
                              playlistId: activePlaylistId,
                              canMoveUp: index > 0,
                              canMoveDown: index < activePlaylistTracks.length - 1
                            })
                          )
                          .join('')
                      : emptyState('Playlist ini belum punya lagu.')
                  }
                </div>
              `
                : '<p>No playlist selected.</p>'
            }
          </div>
        </section>
      `;
    }

    return `
      <section>
        <h2>Your Library</h2>
        <div class="song-list">
          ${library.length
            ? library.map(song => songCard({ song, isLiked: favoriteIds.has(song.id), playlists: state.playlists, showAddPlaylist: true })).join('')
            : emptyState('Belum ada lagu ditemukan.')}
        </div>
      </section>
    `;
  };

  mount(
    root,
    `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="logo"><i class="fab fa-spotify"></i> KingPin Music</div>
        <nav class="nav-list">
          ${NAV_ITEMS.map(item => `<button class="${currentView === item.key ? 'active' : ''}" data-action="switch-view" data-view="${item.key}"><i class="fas ${item.icon}"></i>${item.label}</button>`).join('')}
        </nav>
        <div class="upload-box">
          <h4>Upload Song</h4>
          <label class="file-picker">
            <input type="file" id="uploadInput" accept="audio/*" multiple data-action="captureUploadFiles">
            <span><i class="fas fa-folder-open"></i> Choose Audio (Multi)</span>
          </label>
          <p class="upload-hint">${state.pendingUploadsCount ? `${state.pendingUploadsCount} file selected` : 'Belum ada file dipilih.'}</p>
          <button class="btn btn-primary" data-action="open-upload-modal"><i class="fas fa-cloud-arrow-up"></i> Upload ke Supabase</button>
        </div>
        <button class="btn btn-ghost" data-action="logout">Logout</button>
      </aside>

      <main class="main">
        <header class="topbar">
          <div class="search-wrap">
            <i class="fas fa-search"></i>
            <input type="text" id="globalSearch" data-action="search" value="${state.searchQuery || ''}" placeholder="Search songs, artist, album">
          </div>
          <div class="profile-pill">
            <i class="fas fa-user-circle"></i>
            ${state.currentUser?.email || 'Unknown user'}
          </div>
        </header>

        <div class="content">
          ${renderView()}
        </div>

        <section class="offline-section">
          <div class="offline-status">
            Offline Sync: ${state.offlineSyncState.status} (${state.offlineSyncState.synced}/${state.offlineSyncState.total}) ${state.offlineSyncState.message || ''}
            <button class="btn btn-outline" data-action="sync-offline">Sync All Library</button>
          </div>
        </section>
      </main>
    </div>

    <footer class="player-bar">
      <div class="now-playing">
        ${coverArtwork(nowPlaying, 'cover-lg')}
        <div>
          <div class="song-title">${nowPlaying?.title || 'Belum ada lagu diputar'}</div>
          <div class="song-sub">${nowPlaying ? `${nowPlaying.artist} - ${nowPlaying.album}` : 'Unknown Artist - Single'}</div>
        </div>
      </div>
      <div class="player-center">
        <div class="player-actions">
          <button class="icon-btn ${state.player.shuffle ? 'is-active' : ''}" data-action="toggle-shuffle"><i class="fas fa-shuffle"></i></button>
          <button class="icon-btn" data-action="prev"><i class="fas fa-backward-step"></i></button>
          <button class="icon-btn btn-main" data-action="toggle-play"><i class="fas ${state.player.isPlaying ? 'fa-pause' : 'fa-play'}"></i></button>
          <button class="icon-btn" data-action="next"><i class="fas fa-forward-step"></i></button>
          <button class="icon-btn" data-action="toggle-eq-panel" title="Equalizer">
            <i class="fas fa-sliders"></i>
          </button>
        </div>
        <div class="seek-row">
          <span>${formatTime(state.player.currentTime)}</span>
          <input type="range" min="0" max="100" value="${
            state.player.duration > 0 ? Math.round((state.player.currentTime / state.player.duration) * 100) : 0
          }" data-action="seek">
          <span>${formatTime(state.player.duration)}</span>
        </div>
      </div>
      <div class="volume-box">
        <i class="fas fa-volume-high"></i>
        <input type="range" min="0" max="100" value="${Math.round((state.player.volume || 1) * 100)}" data-action="volume">
      </div>
      <div class="eq-popover ${state.eqPanelOpen ? 'is-open' : ''}">
        <div class="eq-popover-header">
          <strong>Equalizer + Audio Pro</strong>
          <label class="toggle">
            <input type="checkbox" data-action="eq-toggle" ${state.eqState.enabled ? 'checked' : ''}>
            <span>Enabled</span>
          </label>
        </div>
        <div class="eq-popover-grid">${eqSliders(state.eqState)}</div>
        <div class="eq-footer">
          <label>Preamp
            <input type="range" min="-12" max="12" step="0.5" value="${state.eqState.preamp}" data-action="eq-preamp">
          </label>
          <label>Crossfade (${state.player.crossfadeSeconds}s)
            <input type="range" min="0" max="8" step="1" value="${state.player.crossfadeSeconds}" data-action="crossfade">
          </label>
        </div>
        <div class="eq-actions">
          <button class="btn btn-outline" data-action="save-eq">Save Setting</button>
          <button class="btn btn-ghost" data-action="reset-eq">Reset</button>
        </div>
      </div>
    </footer>

    <div class="notice-stack">
      ${(state.notices || []).slice(-4).map(noticeItem).join('')}
    </div>

    <div class="modal-backdrop hidden" id="uploadModal">
      <div class="modal-card">
        <h3>Metadata Review</h3>
        <p id="uploadModalSongLabel"></p>
        <form id="metadataForm">
          <label>Title <input id="metaTitle" required></label>
          <label>Artist <input id="metaArtist" required></label>
          <label>Album <input id="metaAlbum" required></label>
          <label>Track Number <input id="metaTrack" type="number"></label>
          <label>Year <input id="metaYear" type="number"></label>
          <label>Genre <input id="metaGenre"></label>
          <label>Override Cover Art <input id="metaCover" type="file" accept="image/*"></label>
          <div class="modal-actions">
            <button class="btn btn-primary" type="submit">Upload</button>
            <button class="btn btn-ghost" type="button" data-action="cancel-upload-modal">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  `
  );

  root.__appHandlers = handlers;

  if (!root.__appBound) {
    root.addEventListener('click', event => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const clickable = target.closest('[data-action]');
      if (!clickable) return;
      const action = clickable.getAttribute('data-action');
      if (!action) return;
      root.__appHandlers?.[action]?.(event, clickable);
    });

    const forwardByDataAction = event => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const action = target.getAttribute('data-action');
      if (action) {
        root.__appHandlers?.[action]?.(event, target);
        return;
      }
      if (target.id === 'uploadInput') {
        root.__appHandlers?.captureUploadFiles?.(event, target);
      }
      if (target.id === 'globalSearch') {
        root.__appHandlers?.search?.(event, target);
      }
    };

    root.addEventListener('input', forwardByDataAction);
    root.addEventListener('change', forwardByDataAction);

    root.addEventListener('submit', event => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      if (form.id === 'metadataForm') {
        root.__appHandlers?.submitMetadataUpload?.(event, form);
      }
    });

    root.__appBound = true;
  }
};



