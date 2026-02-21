import { supabase } from '../lib/supabaseClient.js';
import { byPosition } from '../utils/format.js';

export const queueClient = {
  async load(userId) {
    const { data, error } = await supabase
      .from('queue_items')
      .select('id, song_id, position, songs(*)')
      .eq('user_id', userId)
      .order('position', { ascending: true });
    if (error) throw error;
    return (data ?? []).sort(byPosition);
  },

  async clear(userId) {
    const { error } = await supabase.from('queue_items').delete().eq('user_id', userId);
    if (error) throw error;
  },

  async enqueue(userId, songId) {
    const { data: lastRows, error: lastError } = await supabase
      .from('queue_items')
      .select('position')
      .eq('user_id', userId)
      .order('position', { ascending: false })
      .limit(1);
    if (lastError) throw lastError;

    const nextPosition = lastRows?.length ? Number(lastRows[0].position) + 1 : 0;
    const { data, error } = await supabase
      .from('queue_items')
      .insert({
        user_id: userId,
        song_id: songId,
        position: nextPosition
      })
      .select('id, song_id, position, songs(*)')
      .single();
    if (error) throw error;
    return data;
  },

  async dequeue(userId, queueItemId) {
    const { error } = await supabase.from('queue_items').delete().eq('user_id', userId).eq('id', queueItemId);
    if (error) throw error;
  },

  async enqueueNext(userId, songId) {
    const { data: rows, error: loadError } = await supabase
      .from('queue_items')
      .select('id, position')
      .eq('user_id', userId)
      .order('position', { ascending: false });

    if (loadError) throw loadError;

    for (const row of rows ?? []) {
      const { error: shiftError } = await supabase
        .from('queue_items')
        .update({ position: Number(row.position) + 1 })
        .eq('user_id', userId)
        .eq('id', row.id);
      if (shiftError) throw shiftError;
    }

    const { data, error } = await supabase
      .from('queue_items')
      .insert({
        user_id: userId,
        song_id: songId,
        position: 0
      })
      .select('id, song_id, position, songs(*)')
      .single();

    if (error) throw error;
    return data;
  },

  async reorder(userId, orderedQueueItemIds) {
    const baseOffset = 100000;
    for (let i = 0; i < orderedQueueItemIds.length; i += 1) {
      const { error } = await supabase
        .from('queue_items')
        .update({ position: baseOffset + i })
        .eq('user_id', userId)
        .eq('id', orderedQueueItemIds[i]);
      if (error) throw error;
    }

    for (let i = 0; i < orderedQueueItemIds.length; i += 1) {
      const { error } = await supabase
        .from('queue_items')
        .update({ position: i })
        .eq('user_id', userId)
        .eq('id', orderedQueueItemIds[i]);
      if (error) throw error;
    }
  }
};
