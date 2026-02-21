import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';
import { corsHeaders } from '../_shared/cors.ts';

type BatchInput = {
  song_ids: string[];
  expires_in_seconds?: number;
};

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Missing bearer token' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const token = authHeader.replace('Bearer ', '');
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser(token);

  if (userError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const body = (await req.json()) as BatchInput;
  const songIds = Array.isArray(body.song_ids) ? body.song_ids : [];
  if (!songIds.length) {
    return new Response(JSON.stringify({ data: [] }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const expires = Number(body.expires_in_seconds) > 0 ? Number(body.expires_in_seconds) : 60 * 20;

  const { data: songs, error: songsError } = await supabase
    .from('songs')
    .select('id, owner_id, audio_path')
    .eq('owner_id', user.id)
    .in('id', songIds);

  if (songsError) {
    return new Response(JSON.stringify({ error: songsError.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const data = await Promise.all(
    (songs ?? []).map(async song => {
      const { data: signedData, error: signedError } = await supabase.storage
        .from('user-audio')
        .createSignedUrl(song.audio_path, expires);

      return {
        song_id: song.id,
        signed_url: signedData?.signedUrl ?? null,
        expires_at: signedData?.signedUrl ? new Date(Date.now() + expires * 1000).toISOString() : null,
        error: signedError?.message ?? null
      };
    })
  );

  return new Response(JSON.stringify({ data }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
});
