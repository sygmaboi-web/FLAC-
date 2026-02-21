-- KingPin Music v2 schema
-- Applies locked decisions:
-- 1) Multi-user auth with strict privacy
-- 2) Private storage with signed URLs
-- 3) Legacy songs are dropped (fresh start)

create extension if not exists pgcrypto;

-- ===== Cleanup legacy schema =====
drop table if exists public.songs cascade;

delete from storage.objects where bucket_id = 'songs';
delete from storage.buckets where id = 'songs';

-- ===== Core profile =====
create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    display_name text,
    avatar_url text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles(id, display_name, avatar_url)
    values (
        new.id,
        coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
        new.raw_user_meta_data->>'avatar_url'
    )
    on conflict (id) do nothing;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user_profile();

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

-- ===== Songs =====
create table if not exists public.songs (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade,
    title text not null,
    artist text not null default 'Unknown Artist',
    album text not null default 'Single',
    track_number int,
    year int,
    genre text,
    duration_seconds numeric(10, 3),
    mime_type text,
    size_bytes bigint,
    bitrate int,
    sample_rate int,
    channels int,
    audio_path text not null unique,
    cover_path text,
    loudness_lufs numeric(6, 2),
    normalize_gain_db numeric(6, 2),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

drop trigger if exists trg_songs_touch_updated_at on public.songs;
create trigger trg_songs_touch_updated_at
before update on public.songs
for each row execute function public.touch_updated_at();

-- ===== Playlists =====
create table if not exists public.playlists (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade,
    name text not null,
    description text,
    is_public boolean not null default false,
    cover_path text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

drop trigger if exists trg_playlists_touch_updated_at on public.playlists;
create trigger trg_playlists_touch_updated_at
before update on public.playlists
for each row execute function public.touch_updated_at();

create table if not exists public.playlist_tracks (
    id bigserial primary key,
    playlist_id uuid not null references public.playlists(id) on delete cascade,
    song_id uuid not null references public.songs(id) on delete cascade,
    position int not null check (position >= 0),
    added_at timestamptz not null default now(),
    unique (playlist_id, position)
);

create index if not exists idx_playlist_tracks_playlist on public.playlist_tracks (playlist_id, position);

-- ===== User activity =====
create table if not exists public.favorites (
    user_id uuid not null references auth.users(id) on delete cascade,
    song_id uuid not null references public.songs(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (user_id, song_id)
);

create table if not exists public.recently_played (
    id bigserial primary key,
    user_id uuid not null references auth.users(id) on delete cascade,
    song_id uuid not null references public.songs(id) on delete cascade,
    played_at timestamptz not null default now(),
    source text
);

create index if not exists idx_recently_played_user_time on public.recently_played (user_id, played_at desc);

create table if not exists public.queue_items (
    id bigserial primary key,
    user_id uuid not null references auth.users(id) on delete cascade,
    song_id uuid not null references public.songs(id) on delete cascade,
    position int not null check (position >= 0),
    created_at timestamptz not null default now(),
    unique (user_id, position)
);

create index if not exists idx_queue_items_user_position on public.queue_items (user_id, position);

-- ===== Sharing =====
create table if not exists public.share_links (
    id uuid primary key default gen_random_uuid(),
    playlist_id uuid not null references public.playlists(id) on delete cascade,
    token text not null unique,
    is_active boolean not null default true,
    requires_login boolean not null default false,
    expires_at timestamptz,
    created_at timestamptz not null default now()
);

create index if not exists idx_share_links_playlist on public.share_links (playlist_id);

-- ===== RLS =====
alter table public.profiles enable row level security;
alter table public.songs enable row level security;
alter table public.playlists enable row level security;
alter table public.playlist_tracks enable row level security;
alter table public.favorites enable row level security;
alter table public.recently_played enable row level security;
alter table public.queue_items enable row level security;
alter table public.share_links enable row level security;

drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_select on public.profiles
for select using (id = auth.uid());

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles
for update using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists songs_owner_all on public.songs;
create policy songs_owner_all on public.songs
for all using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists playlists_owner_all on public.playlists;
create policy playlists_owner_all on public.playlists
for all using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists playlists_public_read on public.playlists;
create policy playlists_public_read on public.playlists
for select using (is_public = true);

drop policy if exists playlist_tracks_owner_rw on public.playlist_tracks;
create policy playlist_tracks_owner_rw on public.playlist_tracks
for all using (
    exists (
        select 1 from public.playlists p
        where p.id = playlist_tracks.playlist_id
        and p.owner_id = auth.uid()
    )
)
with check (
    exists (
        select 1 from public.playlists p
        where p.id = playlist_tracks.playlist_id
        and p.owner_id = auth.uid()
    )
);

drop policy if exists playlist_tracks_public_read on public.playlist_tracks;
create policy playlist_tracks_public_read on public.playlist_tracks
for select using (
    exists (
        select 1 from public.playlists p
        where p.id = playlist_tracks.playlist_id
        and p.is_public = true
    )
);

drop policy if exists favorites_owner_all on public.favorites;
create policy favorites_owner_all on public.favorites
for all using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists recently_owner_all on public.recently_played;
create policy recently_owner_all on public.recently_played
for all using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists queue_owner_all on public.queue_items;
create policy queue_owner_all on public.queue_items
for all using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists share_links_owner_all on public.share_links;
create policy share_links_owner_all on public.share_links
for all using (
    exists (
        select 1 from public.playlists p
        where p.id = share_links.playlist_id
        and p.owner_id = auth.uid()
    )
)
with check (
    exists (
        select 1 from public.playlists p
        where p.id = share_links.playlist_id
        and p.owner_id = auth.uid()
    )
);

drop policy if exists share_links_public_read on public.share_links;
create policy share_links_public_read on public.share_links
for select using (
    is_active = true
    and (expires_at is null or expires_at > now())
);

-- ===== Storage buckets =====
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
    (
        'user-audio',
        'user-audio',
        false,
        536870912,
        array['audio/flac', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/ogg']
    ),
    (
        'user-covers',
        'user-covers',
        false,
        10485760,
        array['image/jpeg', 'image/png', 'image/webp']
    )
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- User can manage only their own object folder:
-- users/{auth.uid()}/...
drop policy if exists storage_audio_owner_all on storage.objects;
drop policy if exists songs_storage_public_read on storage.objects;
drop policy if exists songs_storage_public_insert on storage.objects;
create policy storage_audio_owner_all
on storage.objects
for all
using (
    bucket_id = 'user-audio'
    and split_part(name, '/', 1) = 'users'
    and split_part(name, '/', 2) = auth.uid()::text
)
with check (
    bucket_id = 'user-audio'
    and split_part(name, '/', 1) = 'users'
    and split_part(name, '/', 2) = auth.uid()::text
);

drop policy if exists storage_cover_owner_all on storage.objects;
create policy storage_cover_owner_all
on storage.objects
for all
using (
    bucket_id = 'user-covers'
    and split_part(name, '/', 1) = 'users'
    and split_part(name, '/', 2) = auth.uid()::text
)
with check (
    bucket_id = 'user-covers'
    and split_part(name, '/', 1) = 'users'
    and split_part(name, '/', 2) = auth.uid()::text
);
