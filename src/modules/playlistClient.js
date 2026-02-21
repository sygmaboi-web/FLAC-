import { supabase } from '../lib/supabaseClient.js';
import { byPosition } from '../utils/format.js';

export const playlistClient = {
  async listPlaylists(userId) {
    const { data, error } = await supabase
      .from('playlists')
      .select('*')
      .eq('owner_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async createPlaylist(ownerId, payload) {
    const { data, error } = await supabase
      .from('playlists')
      .insert({
        owner_id: ownerId,
        name: payload.name,
        description: payload.description || null,
        is_public: Boolean(payload.is_public)
      })
      .select('*')
      .single();
    if (error) throw error;
    return data;
  },

  async updatePlaylist(id, patch) {
    const { data, error } = await supabase.from('playlists').update(patch).eq('id', id).select('*').single();
    if (error) throw error;
    return data;
  },

  async deletePlaylist(id) {
    const { error } = await supabase.from('playlists').delete().eq('id', id);
    if (error) throw error;
  },

  async listPlaylistTracks(playlistId) {
    const { data, error } = await supabase
      .from('playlist_tracks')
      .select('id, playlist_id, song_id, position, added_at, songs(*)')
      .eq('playlist_id', playlistId)
      .order('position', { ascending: true });
    if (error) throw error;
    return (data ?? []).sort(byPosition);
  },

  async addTrack(playlistId, songId) {
    const { data: tracks, error: tracksError } = await supabase
      .from('playlist_tracks')
      .select('position')
      .eq('playlist_id', playlistId)
      .order('position', { ascending: false })
      .limit(1);

    if (tracksError) throw tracksError;
    const nextPosition = tracks?.length ? Number(tracks[0].position) + 1 : 0;

    const { data, error } = await supabase
      .from('playlist_tracks')
      .insert({ playlist_id: playlistId, song_id: songId, position: nextPosition })
      .select('*')
      .single();
    if (error) throw error;
    return data;
  },

  async removeTrack(trackId) {
    const { error } = await supabase.from('playlist_tracks').delete().eq('id', trackId);
    if (error) throw error;
  },

  async reorderTracks(playlistId, orderedTrackIds) {
    const baseOffset = 100000;
    for (let i = 0; i < orderedTrackIds.length; i += 1) {
      const { error } = await supabase
        .from('playlist_tracks')
        .update({ position: baseOffset + i })
        .eq('playlist_id', playlistId)
        .eq('id', orderedTrackIds[i]);
      if (error) throw error;
    }

    for (let i = 0; i < orderedTrackIds.length; i += 1) {
      const { error } = await supabase
        .from('playlist_tracks')
        .update({ position: i })
        .eq('playlist_id', playlistId)
        .eq('id', orderedTrackIds[i]);
      if (error) throw error;
    }
  }
};
