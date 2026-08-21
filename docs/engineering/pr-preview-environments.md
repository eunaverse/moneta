# PR preview environments

## Decision and activation boundary

Moneta's PR preview automation is committed but intentionally disabled until an isolated Supabase resource and the preview access policy have explicit approval. Set both repository variables `PR_PREVIEW_ENABLED=true` and `PR_PREVIEW_ACCESS_REVIEWED=true` only after completing the checklist below. Until then, pull requests still run the full quality gate and the workflow explains why no external preview was created.

This boundary avoids silently creating a paid service, connecting a preview to production data, or publishing a private finance application before its access policy has been reviewed.

## Current repository audit

- Production builds read `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`; the browser is expected to receive only those public project values.
- The server reads `MONETA_TRANSACTION_AI_TOKEN` from a Cloudflare Worker secret. It is not a `VITE_` variable and must never enter a browser bundle or workflow log.
- `supabase/migrations/001_moneta.sql` creates user-scoped RLS and a private receipt bucket. `002_finance_state_realtime.sql` adds the table to Realtime.
- There is no committed production dump, financial seed, `supabase/config.toml`, or Supabase management credential.
- The repository state alone does not reveal the current Supabase organization plan or whether Branching is enabled. Confirm both in the Supabase dashboard before changing that account.

## Official platform findings (verified 2026-08-20)

### Cloudflare

[`wrangler versions upload --preview-alias`](https://developers.cloudflare.com/workers/versions-and-deployments/preview-urls/) creates a stable, human-readable URL without routing production traffic to that version. Moneta uses `pr-<number>`, so the alias has the form `https://pr-<number>-moneta.<workers-dev-subdomain>.workers.dev`.

Preview URLs are public when enabled. Cloudflare documents a Worker-scoped [`preview_worker` Access destination](https://developers.cloudflare.com/workers/configuration/cloudflare-access/) that protects previews without changing production access. Wrangler also supports declaring required secrets and supplying a secret file during [`versions upload`](https://developers.cloudflare.com/workers/configuration/secrets/).

### Supabase

[Supabase Branching](https://supabase.com/docs/guides/deployment/branching) creates a separate Auth, Database, Storage, and Realtime environment for each branch. Preview branches start without production data and the GitHub integration automatically deletes an ephemeral branch when its PR is merged or closed.

Branching is not a zero-cost toggle. Current [Branching usage documentation](https://supabase.com/docs/guides/platform/manage-your-usage/branching) says Micro compute starts at **$0.01344 per hour**, other usage is also billable, Branching compute credits do not apply, and branches are not covered by the Spend Cap. Therefore this repository does not enable Supabase Branching or create a project without explicit approval.

### GitHub

GitHub does not pass Actions secrets to workflows triggered by a pull request from a fork. Moneta additionally checks `github.event.pull_request.head.repo.full_name == github.repository`, never uses `pull_request_target`, and checks out the trusted base revision for close cleanup. See GitHub's [secret restrictions](https://docs.github.com/en/code-security/reference/secret-security/secret-types).

The remaining trust boundary is deliberate: code in an internal same-repository PR runs in a preview Worker that can use the AI secret at runtime. Only trusted collaborators may push internal branches. For stronger containment, place the `pr-preview` environment behind required reviewers and use a separate low-quota preview OpenAI credential; either change requires an explicit operational decision because it changes the automatic workflow or creates a new credential.

## Approved fallback: one dedicated preview Supabase project

Use one non-production Supabase project shared by PR previews. It is isolated from production even though it is not isolated between PRs. Creating or reusing that external project still needs explicit approval.

1. Create or identify a project whose sole purpose is Moneta preview testing.
2. Apply only `supabase/migrations/001_moneta.sql` and `002_finance_state_realtime.sql`.
3. Do not restore a production dump, copy Auth users, upload receipts, or copy any production data. Leave `public.finance_states` and `storage.objects` empty. Testers may create synthetic records only.
4. Verify the empty baseline before activation:

   ```sql
   select count(*) from public.finance_states;
   select count(*) from storage.objects;
   ```

5. Enable Google Auth in the preview project. In Google Auth Platform, add the exact preview-project callback URI:

   `https://<preview-project-ref>.supabase.co/auth/v1/callback`

   The app uses Supabase's redirect-based OAuth flow; never put the Google client secret in GitHub, Cloudflare, or browser code. Supabase's [Google guide](https://supabase.com/docs/guides/auth/social-login/auth-google) identifies the project callback as Google's authorized redirect URI.
6. In Supabase Authentication → URL Configuration, add this narrowly scoped additional Redirect URL:

   `https://pr-*-moneta.<workers-dev-subdomain>.workers.dev/**`

   The pattern fixes the Worker name, account subdomain, and `pr-` prefix. It is intentionally narrower than `https://**.workers.dev/**`. The application passes `window.location.origin` as `redirectTo`, and Supabase requires it to match the [redirect allow-list](https://supabase.com/docs/guides/auth/redirect-urls/).
7. Create a GitHub environment named `pr-preview` with these secrets:

   - `CLOUDFLARE_API_TOKEN` — least-privilege Workers Scripts write token
   - `CLOUDFLARE_ACCOUNT_ID`
   - `PREVIEW_SUPABASE_URL`
   - `PREVIEW_SUPABASE_ANON_KEY` — public by design; RLS remains mandatory
   - `MONETA_TRANSACTION_AI_TOKEN` — server-only

   Add environment variable `PR_PREVIEW_SUPABASE_PROJECT_REF` with the approved preview project ref. Add repository variable `PRODUCTION_SUPABASE_PROJECT_REF` with the public ref of the production project. The workflow rejects a URL whose hostname does not exactly match the preview ref and also rejects equal preview/production refs.
8. Review Cloudflare Access before publishing previews. Recommended for this private finance UI: protect Worker `moneta` previews with a `preview_worker` application and allow only the Cloudflare account or explicitly approved email identities. If the preview must remain public, record that decision and its exposure before continuing.
9. Set repository variables `PR_PREVIEW_ACCESS_REVIEWED=true` and then `PR_PREVIEW_ENABLED=true`.

## Runtime and secret flow

After `npm run verify` succeeds, the preview job rebuilds with only the dedicated preview project's public URL/key. It creates a mode-`0600` temporary JSON file containing `MONETA_TRANSACTION_AI_TOKEN`, calls `wrangler versions upload --secrets-file`, and removes the temporary directory in a `finally` block. The secret is never passed as a command-line argument, printed, or assigned to a `VITE_` variable.

The upload uses `--preview-alias pr-<number>` and `--tag moneta-pr-<number>`. Wrangler's structured output supplies the alias URL and version ID. The workflow exposes only those non-secret values in the GitHub Deployment environment, Job Summary, and a sticky PR comment.

## Update and close cleanup

- A new commit cancels an older run. After a successful upload, every older Worker version tagged for that PR is deleted while the new version remains the alias target.
- When a PR is merged or closed, cleanup checks out code from `github.event.pull_request.base.sha`, lists Worker versions through the Cloudflare API, deletes only versions tagged `moneta-pr-<number>`, and marks the PR's GitHub Deployment inactive. No production deployment uses that tag.
- Cloudflare does not document a separate Wrangler command for deleting a preview alias. Deleting every tagged target version removes the live preview target; verify the old alias is inactive after the first enabled close run.
- The dedicated preview Supabase project is shared infrastructure, so closing one PR does not delete it. Keep it empty/synthetic and delete the project only through a separately approved decommissioning change.
- If paid Supabase Branching is approved later, use the GitHub integration instead. Its ephemeral PR branch is data-less and is automatically deleted on merge/close; add a required Supabase Preview check before merging.

## Security review

Without Access, anyone who learns a preview URL can download the client bundle, reach the login page, and probe public HTTP endpoints. RLS and bearer-token verification still protect Supabase records and OpenAI inference, but they do not make the URL private. Public previews also expand the surface for dependency probing and denial-of-wallet attempts.

Cloudflare Access is therefore recommended before activation. It adds an identity gate ahead of the Worker while Google OAuth still returns to the exact allow-listed preview origin. Recheck the full sign-in round trip, Supabase Realtime, receipt upload, and AI draft creation after Access is enabled.
