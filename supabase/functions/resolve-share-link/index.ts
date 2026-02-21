import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';
import { corsHeaders } from '../_shared/cors.ts';

type CreateShareInput = {
  playlist_id: string;
  expires_in_hours?: number | null;
  requires_login?: boolean;
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

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const token = authHeader.replace('Bearer ', '');
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

  const body = (await req.json()) as CreateShareInput;
  if (!body.playlist_id) {
    return new Response(JSON.stringify({ error: 'playlist_id is required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const { data: playlist, error: playlistError } = await supabase
    .from('playlists')
    .select('id, owner_id')
    .eq('id', body.playlist_id)
    .single();

  if (playlistError || !playlist || playlist.owner_id !== user.id) {
    return new Response(JSON.stringify({ error: 'Playlist not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const linkToken = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
  const expiresAt =
    body.expires_in_hours && body.expires_in_hours > 0
      ? new Date(Date.now() + body.expires_in_hours * 60 * 60 * 1000).toISOString()
      : null;

  const { data: link, error: insertError } = await supabase
    .from('share_links')
    .insert({
      playlist_id: playlist.id,
      token: linkToken,
      is_active: true,
      requires_login: Boolean(body.requires_login),
      expires_at: expiresAt
    })
    .select('token, expires_at, requires_login')
    .single();

  if (insertError || !link) {
    return new Response(JSON.stringify({ error: insertError?.message ?? 'Failed to create link' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const shareUrl = `${new URL(req.url).origin}/share/${link.token}`;

  return new Response(
    JSON.stringify({
      token: link.token,
      share_url: shareUrl,
      expires_at: link.expires_at,
      requires_login: link.requires_login
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
