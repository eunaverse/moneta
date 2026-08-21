# PR preview environments

## Decision and activation boundary

Moneta's PR preview automation is enabled only after an isolated Supabase resource and the preview access policy have explicit approval. Set both repository variables `PR_PREVIEW_ENABLED=true` and `PR_PREVIEW_ACCESS_REVIEWED=true` only after completing the checklist below. `PR_PREVIEW_ACCESS_REVIEWED=true` means the exposure decision has been recorded; it does not by itself claim that Cloudflare Access is enabled.

This boundary avoids silently creating a paid service, connecting a preview to production data, or publishing a private finance application before its access policy has been reviewed.

### Approved no-cost configuration (2026-08-21)

- The Supabase organization was verified on the Free plan with one free-project slot available. A second project dedicated to Moneta preview was created on Free/nano without a paid upgrade.
- Only `001_moneta.sql` and `002_finance_state_realtime.sql` were applied. Before activation, `public.finance_states` and `storage.objects` both contained zero rows, all eight expected RLS policies were present, and `finance_states` was in the Realtime publication. No production dump, Auth user, receipt, or financial record was copied.
- A separate no-billing Google Cloud project and OAuth web client were created for preview. Google accepts only the preview Supabase callback, and Supabase accepts only the stable PR Worker hostname pattern described below.
- The Cloudflare Workers account is on Workers Free. The Zero Trust Free checkout required a payment method and explicit authorization for monthly overage charges. Because the approval condition is zero spend with no charge authorization, checkout was exited and Access was not activated.
- The approved result is therefore a **public preview** on Workers Free. Anyone with the URL can reach the login surface. The mitigations are the dedicated empty/synthetic Supabase project, user-scoped RLS, private Storage, authenticated AI requests, fork exclusion, server-only provider credentials, narrow OAuth redirects, required deployment approval, and owner-checked Worker cleanup.
- `PR_PREVIEW_ACCESS_REVIEWED=true` records this public-exposure review. No billing profile, paid plan, free trial, Supabase Branching, or production-data copy is authorized by this decision.

## Current repository audit

- Production builds read `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`; the browser is expected to receive only those public project values.
- The server reads `MONETA_TRANSACTION_AI_TOKEN` from a Cloudflare Worker secret. It is not a `VITE_` variable and must never enter a browser bundle or workflow log.
- `supabase/migrations/001_moneta.sql` creates user-scoped RLS and a private receipt bucket. `002_finance_state_realtime.sql` adds the table to Realtime.
- There is no committed production dump, financial seed, `supabase/config.toml`, or Supabase management credential.
- The repository state alone does not reveal the current Supabase organization plan or whether Branching is enabled. Confirm both in the Supabase dashboard before changing that account.

## Official platform findings (verified 2026-08-21)

### Cloudflare

[`wrangler deploy --name`](https://developers.cloudflare.com/workers/wrangler/commands/workers/#deploy) can target an independent Worker instead of the production `moneta` Worker. Moneta deploys approved PRs to one shared Worker named `review-moneta`, producing the fixed URL `https://review-moneta.<workers-dev-subdomain>.workers.dev`. The next approved PR replaces the active preview without changing production `moneta`.

Workers.dev URLs are public when enabled. Wrangler supports declaring required secrets and supplying a secret file during [`deploy`](https://developers.cloudflare.com/workers/configuration/secrets/). If Cloudflare Access is approved later, protect the exact PR hostname pattern rather than changing access to the production Worker.

### Supabase

[Supabase Branching](https://supabase.com/docs/guides/deployment/branching) creates a separate Auth, Database, Storage, and Realtime environment for each branch. Preview branches start without production data and the GitHub integration automatically deletes an ephemeral branch when its PR is merged or closed.

Branching is not a zero-cost toggle. Current [Branching usage documentation](https://supabase.com/docs/guides/platform/manage-your-usage/branching) says Micro compute starts at **$0.01344 per hour**, other usage is also billable, Branching compute credits do not apply, and branches are not covered by the Spend Cap. Therefore this repository does not enable Supabase Branching or create a project without explicit approval.

### GitHub

GitHub does not pass Actions secrets to workflows triggered by a pull request from a fork. Moneta additionally checks `github.event.pull_request.head.repo.full_name == github.repository`, never uses `pull_request_target`, and checks out the current trusted default branch for close cleanup. See GitHub's [secret restrictions](https://docs.github.com/en/code-security/reference/secret-security/secret-types).

The remaining trust boundary is deliberate: code in an internal same-repository PR can run in a preview Worker that uses the AI secret at runtime, but only after a required reviewer approves the protected `pr-preview` environment. Only trusted collaborators may push internal branches. A separate low-quota preview OpenAI credential would provide stronger cost isolation, but creating one is a separate operational decision.

## Approved fallback: one dedicated preview Supabase project

Use one non-production Supabase project shared by PR previews. It is isolated from production even though it is not isolated between PRs. This fallback received explicit no-cost approval on 2026-08-21.

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

   `https://review-moneta.<workers-dev-subdomain>.workers.dev/**`

   This exact Worker name and account subdomain are narrower than either a PR wildcard or `https://**.workers.dev/**`. The application passes `window.location.origin` as `redirectTo`, and Supabase requires it to match the [redirect allow-list](https://supabase.com/docs/guides/auth/redirect-urls/).
7. Create a GitHub environment named `pr-preview` with these environment secrets:

   - `PREVIEW_SUPABASE_URL`
   - `PREVIEW_SUPABASE_ANON_KEY` — public by design; RLS remains mandatory

   The preview job also reads these existing repository secrets:

   - `CLOUDFLARE_API_TOKEN` — least-privilege Workers Scripts write token
   - `CLOUDFLARE_ACCOUNT_ID`
   - `MONETA_TRANSACTION_AI_TOKEN` — server-only

   Add environment variable `PR_PREVIEW_SUPABASE_PROJECT_REF` with the approved preview project ref. Add repository variable `PRODUCTION_SUPABASE_PROJECT_REF` with the public ref of the production project. The workflow rejects a URL whose hostname does not exactly match the preview ref and also rejects equal preview/production refs.
8. Configure the `pr-preview` GitHub environment with the repository owner as a required reviewer. After verification succeeds, open the waiting job's **Review deployments** dialog and select **Approve and deploy** only for a PR whose preview should replace the current one. Environment secrets are unavailable to the job before approval.
9. Review Cloudflare Access before publishing previews. Recommended for this private finance UI: protect the `review-moneta.<workers-dev-subdomain>.workers.dev` preview host and allow only the Cloudflare account or explicitly approved email identities. The current account required a payment method and overage authorization even for Zero Trust Free, so Access was not activated and the public-preview decision above was recorded instead.
10. Set repository variables `PR_PREVIEW_ACCESS_REVIEWED=true` and then `PR_PREVIEW_ENABLED=true`.

## Runtime and secret flow

After `npm run verify` succeeds, the preview job pauses at the protected `pr-preview` environment. Once the required reviewer selects **Approve and deploy**, it rebuilds with only the dedicated preview project's public URL/key. It creates a mode-`0600` temporary JSON file containing `MONETA_TRANSACTION_AI_TOKEN`, calls `wrangler deploy --name review-moneta --secrets-file`, and removes the temporary directory in a `finally` block. The secret is unavailable before approval and is never passed as a command-line argument, printed, or assigned to a `VITE_` variable.

The deploy uses `--tag moneta-pr-<number>` for ownership and traceability. Wrangler's structured output must identify the exact shared preview Worker and its workers.dev URL before the workflow publishes either value to the GitHub Deployment environment, Job Summary, and sticky PR comment. It rejects output for the production `moneta` Worker. There is intentionally only **one active preview**: an approved deployment replaces the content at the fixed URL.

## Update and close cleanup

- Preview deploy and cleanup jobs share the `moneta-shared-pr-preview` concurrency group, so they cannot race while replacing or deleting the fixed Worker.
- A new commit cancels the older per-PR workflow before approval. Once approved, it deploys to the same `review-moneta` Worker, so PRs cannot accumulate independently reachable websites.
- When a PR is merged or closed, cleanup checks out trusted code from `github.event.repository.default_branch` and reads `/workers/scripts/review-moneta/settings`. It deletes `/workers/scripts/review-moneta` only when the `workers/tag` annotation still equals that PR's `moneta-pr-<number>` tag. If another approved PR owns the Worker, cleanup leaves it untouched. A missing Worker is an idempotent success.
- Cleanup does not use the protected environment or its Supabase secrets, so closing a PR does not require another approval.
- The dedicated preview Supabase project is shared infrastructure, so closing one PR does not delete it. Keep it empty/synthetic and delete the project only through a separately approved decommissioning change.
- If paid Supabase Branching is approved later, use the GitHub integration instead. Its ephemeral PR branch is data-less and is automatically deleted on merge/close; add a required Supabase Preview check before merging.

## Security review

Without Access, anyone who learns a preview URL can download the client bundle, reach the login page, and probe public HTTP endpoints. RLS and bearer-token verification still protect Supabase records and OpenAI inference, but they do not make the URL private. Public previews also expand the surface for dependency probing and denial-of-wallet attempts.

Cloudflare Access remains recommended if it can later be enabled without violating the no-charge policy. It adds an identity gate ahead of the Worker while Google OAuth still returns to the exact allow-listed preview origin. Until then, never use real financial data in a public preview, monitor Free-plan usage, and disable `PR_PREVIEW_ENABLED` immediately if probing or abuse appears. Recheck the full sign-in round trip, Supabase Realtime, receipt upload, and AI draft creation after any Access policy change.
