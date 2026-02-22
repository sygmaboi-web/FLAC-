import { supabase } from '../lib/supabaseClient.js';
import { config } from '../config.js';
import { sanitizeFileName } from '../utils/format.js';

const toSongView = row => ({
  ...row,
  signed_url: null
});

const coverExtFromType = type => {
  if (!type) return 'jpg';
  if (type.includes('png')) return 'png';
  if (type.includes('webp')) return 'webp';
  return 'jpg';
};

export const songsClient = {
  async listMySongs(userId) {
    const { data, error } = await supabase
      .from('songs')
      .select('*')
      .eq('owner_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data ?? []).map(toSongView);
  },

  async signedUrlBatch(songIds, expiresInSeconds = config.signedUrlExpirySeconds) {
    if (!songIds.length) return [];
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) {
      return [];
    }
    const { data, error } = await supabase.functions.invoke('signed-song-url-batch', {
      headers: {
        Authorization: `Bearer ${token}`
      },
      body: {
        song_ids: songIds,
        expires_in_seconds: expiresInSeconds
      }
    });
    if (error) throw error;
    return data?.data ?? [];
  },

  async coverUrlBatch(songRows, expiresInSeconds = config.signedUrlExpirySeconds) {
    const rows = Array.isArray(songRows) ? songRows.filter(song => song?.cover_path) : [];
    if (!rows.length) return [];

    const results = await Promise.all(
      rows.map(async song => {
        const { data, error } = await supabase.storage
          .from(config.storage.coverBucket)
          .createSignedUrl(song.cover_path, expiresInSeconds);

        return {
          song_id: song.id,
          cover_url: data?.signedUrl ?? null,
          error: error?.message ?? null
        };
      })
    );

    return results;
  },

  async uploadSong({ userId, file, metadata }) {
    const songId = crypto.randomUUID();
    const fileSafe = sanitizeFileName(file.name);
    const ext = fileSafe.includes('.') ? fileSafe.split('.').pop() : 'flac';
    const audioPath = `users/${userId}/songs/${songId}.${ext}`;

    const { error: uploadError } = await supabase.storage.from(config.storage.audioBucket).upload(audioPath, file, {
      upsert: false,
      contentType: file.type || 'audio/flac'
    });
    if (uploadError) throw uploadError;

    let coverPath = null;
    if (metadata.coverBlob) {
      const coverExt = coverExtFromType(metadata.coverBlob.type);
      coverPath = `users/${userId}/covers/${songId}.${coverExt}`;
      const { error: coverUploadError } = await supabase
        .storage
        .from(config.storage.coverBucket)
        .upload(coverPath, metadata.coverBlob, {
          upsert: true,
          contentType: metadata.coverBlob.type || 'image/jpeg'
        });

      if (coverUploadError) {
        console.warn('Cover upload failed, continuing song upload:', coverUploadError);
        coverPath = null;
      }
    }

    const payload = {
      id: songId,
      owner_id: userId,
      title: metadata.title || 'Untitled',
      artist: metadata.artist || 'Unknown Artist',
      album: metadata.album || 'Single',
      track_number: metadata.track_number,
      year: metadata.year,
      genre: metadata.genre,
      duration_seconds: metadata.duration_seconds,
      mime_type: file.type || null,
      size_bytes: file.size,
      bitrate: metadata.bitrate,
      sample_rate: metadata.sample_rate,
      channels: metadata.channels,
      audio_path: audioPath,
      cover_path: coverPath,
      loudness_lufs: metadata.loudness_lufs,
      normalize_gain_db: metadata.normalize_gain_db
    };

    const { data: row, error: insertError } = await supabase.from('songs').insert(payload).select('*').single();
    if (insertError) throw insertError;

    return toSongView(row);
  },

  async updateSong(songId, patch) {
    const { data, error } = await supabase.from('songs').update(patch).eq('id', songId).select('*').single();
    if (error) throw error;
    return toSongView(data);
  },

  async deleteSong(song) {
    if (song.audio_path) {
      await supabase.storage.from(config.storage.audioBucket).remove([song.audio_path]);
    }
    if (song.cover_path) {
      await supabase.storage.from(config.storage.coverBucket).remove([song.cover_path]);
    }

    const { error } = await supabase.from('songs').delete().eq('id', song.id);
    if (error) throw error;
  },

  async listFavorites(userId) {
    const { data, error } = await supabase
      .from('favorites')
      .select('song_id, songs(*)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async toggleFavorite(userId, songId, liked) {
    if (liked) {
      const { error } = await supabase.from('favorites').insert({ user_id: userId, song_id: songId });
      if (error) throw error;
      return;
    }

    const { error } = await supabase.from('favorites').delete().eq('user_id', userId).eq('song_id', songId);
    if (error) throw error;
  },

  async listRecentlyPlayed(userId) {
    const { data, error } = await supabase
      .from('recently_played')
      .select('id, song_id, played_at, source, songs(*)')
      .eq('user_id', userId)
      .order('played_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    return data ?? [];
  },

  async addRecentlyPlayed(userId, songId, source = 'player') {
    const { error } = await supabase.from('recently_played').insert({
      user_id: userId,
      song_id: songId,
      source
    });
    if (error) throw error;
  }
};
