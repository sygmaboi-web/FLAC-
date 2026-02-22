-- Create tables
create extension if not exists "uuid-ossp";

create table if not exists songs (
  id uuid primary key,
  owner_id uuid not null,
  title text not null,
  artist text,
  album text,
  track_number int,
  year int,
  genre text,
  duration_seconds int,
  mime_type text,
  size_bytes bigint,
  bitrate int,
  sample_rate int,
  channels int,
  audio_path text not null,
  created_at timestamptz default now()
);

create table if not exists playlists (
  id uuid primary key default uuid_generate_v4(),
  owner_id uuid not null,
  name text not null,
  is_public boolean default false,
  created_at timestamptz default now()
);

create table if not exists playlist_tracks (
  id bigserial primary key,
  playlist_id uuid not null references playlists(id) on delete cascade,
  song_id uuid not null references songs(id) on delete cascade,
  position int default 0
);

create table if not exists favorites (
  user_id uuid not null,
  song_id uuid not null,
  created_at timestamptz default now(),
  primary key (user_id, song_id)
);

create table if not exists recently_played (
  id bigserial primary key,
  user_id uuid not null,
  song_id uuid not null,
  played_at timestamptz default now(),
  source text
);

-- Enable RLS
alter table songs enable row level security;
alter table playlists enable row level security;
alter table playlist_tracks enable row level security;
alter table favorites enable row level security;
alter table recently_played enable row level security;

-- Policies
create policy "songs_owner_read" on songs
  for select using (auth.uid() = owner_id);
create policy "songs_owner_write" on songs
  for insert with check (auth.uid() = owner_id);
create policy "songs_owner_update" on songs
  for update using (auth.uid() = owner_id);
create policy "songs_owner_delete" on songs
  for delete using (auth.uid() = owner_id);

create policy "playlists_owner_read" on playlists
  for select using (auth.uid() = owner_id or is_public = true);
create policy "playlists_owner_write" on playlists
  for insert with check (auth.uid() = owner_id);
create policy "playlists_owner_update" on playlists
  for update using (auth.uid() = owner_id);
create policy "playlists_owner_delete" on playlists
  for delete using (auth.uid() = owner_id);

create policy "playlist_tracks_owner_read" on playlist_tracks
  for select using (
    exists(select 1 from playlists p where p.id = playlist_tracks.playlist_id and (p.owner_id = auth.uid() or p.is_public = true))
  );
create policy "playlist_tracks_owner_write" on playlist_tracks
  for insert with check (
    exists(select 1 from playlists p where p.id = playlist_tracks.playlist_id and p.owner_id = auth.uid())
  );
create policy "playlist_tracks_owner_delete" on playlist_tracks
  for delete using (
    exists(select 1 from playlists p where p.id = playlist_tracks.playlist_id and p.owner_id = auth.uid())
  );

create policy "favorites_owner" on favorites
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "recent_owner" on recently_played
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Storage buckets (create in dashboard)
-- user-audio bucket: set PUBLIC = false or true (recommended: true for simplicity in this minimal setup)
-- If public, you can use public URL; if private, client uses createSignedUrl.
