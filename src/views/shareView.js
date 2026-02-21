import { mount, qs } from '../lib/dom.js';
import { formatTime } from '../utils/format.js';

const toDurationLabel = seconds => {
  if (!Number.isFinite(Number(seconds))) return '--:--';
  return formatTime(Number(seconds));
};

export const renderShareView = ({ root, payload, onPlayTrack, onOpenApp }) => {
  if (!payload) {
    mount(
      root,
      `
      <div class="share-shell">
        <div class="share-card">
          <h1>Share link tidak valid</h1>
          <p>Link tidak ditemukan, tidak aktif, atau sudah expired.</p>
          <button class="btn btn-primary" id="openAppBtn">Open App</button>
        </div>
      </div>
    `
    );
    qs('#openAppBtn', root)?.addEventListener('click', onOpenApp);
    return;
  }

  const playlist = payload.playlist;
  const tracks = payload.tracks_with_signed_urls || [];

  mount(
    root,
    `
    <div class="share-shell">
      <div class="share-card">
        <div class="share-header">
          <h1>${playlist.name}</h1>
          <button class="btn btn-outline" id="openAppBtn">Open App</button>
        </div>
        <p class="share-desc">${playlist.description || 'Public playlist dari KingPin Music.'}</p>
        <div class="share-list">
          ${tracks
            .map(
              track => `
              <button class="share-track" data-song-id="${track.id}" ${track.signed_url ? '' : 'disabled'}>
                <span class="share-track-main">
                  ${
                    track.cover_signed_url
                      ? `<img class="song-cover cover-md" src="${track.cover_signed_url}" alt="Cover ${track.title}" loading="lazy">`
                      : '<span class="song-cover cover-md song-cover-fallback">M</span>'
                  }
                  <span>${track.title}</span>
                </span>
                <span class="share-track-sub">${track.artist} - ${track.album}</span>
                <span class="share-track-duration">${toDurationLabel(track.duration_seconds)}</span>
              </button>
            `
            )
            .join('')}
        </div>
      </div>
      <audio id="shareAudio" controls preload="metadata"></audio>
    </div>
  `
  );

  qs('#openAppBtn', root)?.addEventListener('click', onOpenApp);
  root.querySelectorAll('.share-track').forEach(button => {
    button.addEventListener('click', () => {
      const songId = button.getAttribute('data-song-id');
      if (!songId) return;
      onPlayTrack(songId);
    });
  });
};
