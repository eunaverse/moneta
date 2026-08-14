import { createClient } from "@supabase/supabase-js";

const env = import.meta.env as ImportMetaEnv & {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
};

const url = env.VITE_SUPABASE_URL?.trim() || "";
const anonKey = env.VITE_SUPABASE_ANON_KEY?.trim() || "";

export const hasSupabaseConfig = Boolean(url && anonKey);

export const supabase = hasSupabaseConfig
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
