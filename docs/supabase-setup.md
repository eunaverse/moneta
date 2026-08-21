# Supabase setup

Moneta uses Supabase Auth, Postgres, and private Storage. The browser only receives the public project URL and anonymous key. Never add a service-role key to this app.

1. Create a Supabase project.
2. Run `supabase/migrations/001_moneta.sql` in the Supabase SQL editor.
3. In Authentication, enable Google sign-in. Add the exact Supabase project callback URL to the Google OAuth client, and disable public sign-ups after allowing the intended private-alpha accounts.
4. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to the local and deployment environments.
5. Add the deployed site URL to Authentication → URL Configuration → Redirect URLs.

Production and PR previews must never share a Supabase project. See
[`engineering/pr-preview-environments.md`](engineering/pr-preview-environments.md)
before creating or enabling preview infrastructure.

Row-level security ties every finance document and receipt path to `auth.uid()`. A user cannot query another user's data through the public client key.

The first signed-in session checks for legacy browser data. Moneta only uploads that data after the user chooses **Move to my account**. Receipt images are migrated from IndexedDB into the private `receipts` bucket at the same time.
