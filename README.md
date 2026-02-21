# KingPin Music v2

KingPin Music upgraded to a modular Vite app with:

- Supabase Auth (Google + Email/Password with email verification gate)
- Private per-user library with signed URL playback
- Metadata parsing + editable upload review
- Playlists, queue, favorites, recently played
- Shareable public playlist links (`/share/:token`) via Edge Functions
- PWA shell + offline full-library sync
- Audio engine with EQ, normalization gain support, and crossfade

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Copy env:

```bash
cp .env.example .env
```

3. Fill `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
4. Run app:

```bash
npm run dev
```

## Supabase Setup

1. Run SQL in `supabase-setup.sql`.
2. Deploy edge functions:

```bash
supabase functions deploy create-share-link
supabase functions deploy resolve-share-link
supabase functions deploy signed-song-url-batch
```

3. Set function secrets:

```bash
supabase secrets set SUPABASE_URL=...
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...
```

4. In Supabase Auth:
- Enable Google provider.
- Enable Email/Password.
- Keep email confirmations enabled.

## Notes

- This repository now expects SPA route rewrites to `index.html` for `/auth`, `/app`, and `/share/:token`.
- Legacy public `songs` schema is dropped by design.

