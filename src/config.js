export const config = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL || 'https://nhxjrrfmpeqsgapornxx.supabase.co',
  supabaseAnonKey:
    import.meta.env.VITE_SUPABASE_ANON_KEY ||
    'PASTE_SUPABASE_ANON_KEY',
  edgeBaseUrl:
    import.meta.env.VITE_SUPABASE_FUNCTIONS_URL ||
    `${import.meta.env.VITE_SUPABASE_URL || 'https://nhxjrrfmpeqsgapornxx.supabase.co'}/functions/v1`,
  storage: {
    audioBucket: 'user-audio',
    coverBucket: 'user-covers'
  },
  defaultCrossfadeSeconds: 4,
  signedUrlExpirySeconds: 60 * 20
};

export const hasSupabaseConfig = () => {
  return (
    Boolean(config.supabaseUrl) &&
    Boolean(config.supabaseAnonKey) &&
    !String(config.supabaseAnonKey).includes('PASTE_SUPABASE_ANON_KEY')
  );
};

export const hasGeminiConfig = () => {
  return Boolean(import.meta.env.VITE_GEMINI_API_KEY);
};

