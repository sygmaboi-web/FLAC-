import { supabase } from '../lib/supabaseClient.js';

export const shareClient = {
  async createShareLink(playlistId, options = {}) {
    const { data, error } = await supabase.functions.invoke('create-share-link', {
      body: {
        playlist_id: playlistId,
        expires_in_hours: options.expiresInHours || null,
        requires_login: Boolean(options.requiresLogin)
      }
    });
    if (error) throw error;
    return data;
  },

  async resolveShareLink(token) {
    const { data, error } = await supabase.functions.invoke('resolve-share-link', {
      body: { token }
    });
    if (error) throw error;
    return data;
  }
};
