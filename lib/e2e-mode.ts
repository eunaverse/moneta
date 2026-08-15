import type { Session } from "@supabase/supabase-js";

export const isE2EMode = import.meta.env.VITE_E2E_MODE === "true";

export const e2eSession = {
  access_token: "e2e-access-token",
  refresh_token: "e2e-refresh-token",
  expires_in: 3600,
  token_type: "bearer",
  user: {
    id: "e2e-user",
    aud: "authenticated",
    role: "authenticated",
    email: "e2e@moneta.test",
    app_metadata: {},
    user_metadata: {},
    created_at: "2026-01-01T00:00:00.000Z",
  },
} as Session;
