import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';
import { corsHeaders } from '../_shared/cors.ts';

type ResolveInput = {
  token: string;
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

  const body = (await req.json()) as ResolveInput;
  if (!body.token) {
    return new Response(JSON.stringify({ error: 'token is required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: link, error: linkError } = await supabase
    .from('share_links')
    .select('id, playlist_id, token, is_active, expires_at, requires_login')
    .eq('token', body.token)
    .single();

  if (linkError || !link || !link.is_active) {
    return new Response(JSON.stringify({ error: 'Share link is invalid' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  if (link.expires_at && new Date(link.expires_at).getTime() <= Date.now()) {
    return new Response(JSON.stringify({ error: 'Share link expired' }), {
      status: 410,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  if (link.requires_login) {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Login required for this link' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const userToken = authHeader.replace('Bearer ', '');
    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser(userToken);

    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }

  const { data: playlist, error: playlistError } = await supabase
    .from('playlists')
    .select('id, owner_id, name, description, cover_path, created_at')
    .eq('id', link.playlist_id)
    .single();

  if (playlistError || !playlist) {
    return new Response(JSON.stringify({ error: 'Playlist not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const { data: tracksRows, error: tracksError } = await supabase
    .from('playlist_tracks')
    .select('position, songs(*)')
    .eq('playlist_id', playlist.id)
    .order('position', { ascending: true });

  if (tracksError) {
    return new Response(JSON.stringify({ error: tracksError.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const rawTracks = (tracksRows ?? [])
    .map(item => ({
      position: item.position,
      song: item.songs as Record<string, unknown>
    }))
    .filter(item => Boolean(item.song?.audio_path));

  const signedRows = await Promise.all(
    rawTracks.map(async item => {
      const path = String(item.song.audio_path);
      const { data: signedData } = await supabase.storage.from('user-audio').createSignedUrl(path, 60 * 30);
      let coverUrl: string | null = null;
      if (item.song.cover_path) {
        const { data: coverData } = await supabase.storage.from('user-covers').createSignedUrl(String(item.song.cover_path), 60 * 30);
        coverUrl = coverData?.signedUrl ?? null;
      }
      return {
        ...item.song,
        position: item.position,
        signed_url: signedData?.signedUrl ?? null,
        cover_signed_url: coverUrl
      };
    })
  );

  return new Response(
    JSON.stringify({
      playlist,
      tracks_with_signed_urls: signedRows
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
