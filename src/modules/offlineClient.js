const OFFLINE_CACHE = 'kingpin-audio-v1';
const KEY_PREFIX = '/__offline/song/';

const buildKey = songId => `${window.location.origin}${KEY_PREFIX}${songId}`;

const blobUrlMap = new Map();

export const offlineClient = {
  async estimateStorage() {
    if (!navigator.storage?.estimate) {
      return { quota: null, usage: null, available: null };
    }
    const estimate = await navigator.storage.estimate();
    const quota = estimate.quota ?? null;
    const usage = estimate.usage ?? null;
    return {
      quota,
      usage,
      available: quota && usage ? quota - usage : null
    };
  },

  async syncAllLibrary(songs, onProgress = () => {}) {
    const cache = await caches.open(OFFLINE_CACHE);
    const total = songs.length;
    let synced = 0;
    let failed = 0;

    const signedSongs = songs.filter(song => song.signed_url);
    for (const song of signedSongs) {
      try {
        const response = await fetch(song.signed_url, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Failed download ${song.id}`);
        await cache.put(buildKey(song.id), response.clone());
        synced += 1;
      } catch (error) {
        failed += 1;
        console.warn('Offline sync failed for song', song.id, error);
      }
      onProgress({ total, synced, failed, songId: song.id });
    }

    const keys = await cache.keys();
    const validKeySet = new Set(songs.map(song => buildKey(song.id)));
    await Promise.all(
      keys
        .map(key => key.url)
        .filter(url => url.includes(KEY_PREFIX) && !validKeySet.has(url))
        .map(url => cache.delete(url))
    );

    return { total, synced, failed };
  },

  async clearOfflineLibrary() {
    await caches.delete(OFFLINE_CACHE);
    blobUrlMap.forEach(url => URL.revokeObjectURL(url));
    blobUrlMap.clear();
  },

  async getOfflineObjectUrl(songId) {
    if (blobUrlMap.has(songId)) return blobUrlMap.get(songId);

    const cache = await caches.open(OFFLINE_CACHE);
    const response = await cache.match(buildKey(songId));
    if (!response) return null;

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    blobUrlMap.set(songId, objectUrl);
    return objectUrl;
  }
};
