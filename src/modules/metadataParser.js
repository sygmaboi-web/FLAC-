import { parseBlob } from 'music-metadata-browser';
import { guessMetadataFromFileName } from '../utils/format.js';

const pictureToBlob = picture => {
  if (!picture?.data) return null;
  try {
    const bytes = picture.data instanceof Uint8Array ? picture.data : new Uint8Array(picture.data);
    return new Blob([bytes], { type: picture.format || 'image/jpeg' });
  } catch {
    return null;
  }
};

const parseDbLikeValue = value => {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'object') {
    if (typeof value.dB === 'number' && Number.isFinite(value.dB)) return value.dB;
    if (typeof value.db === 'number' && Number.isFinite(value.db)) return value.db;
    if (typeof value.value === 'number' && Number.isFinite(value.value)) return value.value;
  }
  const match = String(value).match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseR128Gain = value => {
  const raw = parseDbLikeValue(value);
  if (raw == null) return null;
  return raw / 256;
};

const clampNormalizeGain = value => {
  if (!Number.isFinite(value)) return null;
  return Math.max(-24, Math.min(24, value));
};

const extractReplayGainDb = metadata => {
  const common = metadata.common || {};
  const direct = parseDbLikeValue(common.replaygain_track_gain)
    ?? parseDbLikeValue(common.replaygain_album_gain)
    ?? parseDbLikeValue(common.trackGain)
    ?? parseDbLikeValue(common.albumGain);
  if (direct != null) return clampNormalizeGain(direct);

  const native = metadata.native || {};
  for (const tags of Object.values(native)) {
    if (!Array.isArray(tags)) continue;
    for (const tag of tags) {
      const id = String(tag?.id || '').toUpperCase();
      if (!id) continue;
      if (id.includes('REPLAYGAIN_TRACK_GAIN') || id.includes('REPLAYGAIN_ALBUM_GAIN')) {
        const parsed = parseDbLikeValue(tag.value);
        if (parsed != null) return clampNormalizeGain(parsed);
      }
      if (id.includes('R128_TRACK_GAIN') || id.includes('R128_ALBUM_GAIN')) {
        const parsed = parseR128Gain(tag.value);
        if (parsed != null) return clampNormalizeGain(parsed);
      }
    }
  }

  return null;
};

export const metadataParser = {
  async parseFile(file) {
    const fallback = guessMetadataFromFileName(file.name);

    try {
      const metadata = await parseBlob(file, { duration: true, skipPostHeaders: true });
      const common = metadata.common || {};
      const format = metadata.format || {};
      const picture = Array.isArray(common.picture) && common.picture.length ? common.picture[0] : null;
      const coverBlob = pictureToBlob(picture);
      const normalizeGain = extractReplayGainDb(metadata);

      return {
        title: common.title || fallback.title,
        artist: common.artist || fallback.artist,
        album: common.album || fallback.album,
        track_number: Number(common.track?.no) || null,
        year: Number(common.year) || null,
        genre: Array.isArray(common.genre) ? common.genre[0] || null : common.genre || null,
        duration_seconds: Number(format.duration) || null,
        bitrate: Number(format.bitrate) || null,
        sample_rate: Number(format.sampleRate) || null,
        channels: Number(format.numberOfChannels) || null,
        loudness_lufs: null,
        normalize_gain_db: normalizeGain,
        coverBlob
      };
    } catch {
      return {
        ...fallback,
        track_number: null,
        year: null,
        genre: null,
        duration_seconds: null,
        bitrate: null,
        sample_rate: null,
        channels: null,
        loudness_lufs: null,
        normalize_gain_db: null,
        coverBlob: null
      };
    }
  }
};
