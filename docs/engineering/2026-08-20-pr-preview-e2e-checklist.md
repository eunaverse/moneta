# PR preview E2E checklist

## Purpose

Protect the path from an approved pull request through quality verification, isolated preview configuration, Cloudflare version upload, authenticated product review, and resource cleanup. A preview must never route production traffic or connect to production Supabase data.

## Automated workflow states

- Disabled: the full gate passes, no external resource is touched, and the Job Summary names the approval gate.
- Fork: the full gate receives no repository secrets and preview/cleanup jobs are skipped.
- Internal PR opened or updated: `npm run verify` completes before the preview job starts.
- Configuration error: a missing value or Supabase URL/ref mismatch fails before build or upload.
- Upload success: `pr-<number>` points to the new Worker version, stale versions for that PR are deleted, and the URL appears in the Deployment, Job Summary, and sticky PR comment.
- Closed or merged: trusted base code deletes only versions tagged `moneta-pr-<number>` and marks the comment closed.

## Product journeys on the enabled preview

- Open the preview at desktop and Pixel 7 viewports; confirm there is no fatal error, clipping, overlap, or horizontal overflow.
- Confirm the current public preview exposes only the login surface before authentication, and never enter real financial data. If Cloudflare Access is enabled later, confirm an unapproved identity is blocked and an approved identity reaches Moneta.
- Continue with Google and confirm the browser returns to the same `pr-<number>` origin with a preview Supabase session.
- Confirm the new preview account starts with empty balances, budgets, transactions, and receipts.
- Create synthetic transactions and a synthetic receipt; confirm RLS-backed persistence and Realtime refresh.
- Create an AI transaction draft from synthetic text and an image. Confirm inference succeeds, the draft remains editable, and nothing is saved before **Save transaction**.
- Confirm a missing/invalid Supabase bearer token cannot invoke OpenAI.
- Close the PR and confirm its old Cloudflare alias no longer serves the application.

## Responsive and visual review

The existing complete Playwright matrix remains the automated UI gate: Desktop Chrome and Pixel 7. Manually inspect the enabled preview's public login surface, Google return, empty state, populated transaction form, AI loading/result/error states, and receipt controls for hidden CTAs, awkward wrapping, or broken scrolling.

## Test buckets

- `tests/pr-preview.test.mjs`: workflow ordering, fork boundary, isolated credential names, secret-file lifetime, output parsing, and cleanup targeting.
- `tests/harness-contract.test.mjs`: mandatory repository lifecycle and complete quality gate.
- `tests/e2e/ai-transaction-entry.spec.ts`: authorization/error/UI contracts for AI-assisted drafts.
- `tests/e2e/navigation-responsive.spec.ts`: desktop/mobile navigation and overflow.
- `tests/e2e/transactions.spec.ts`: synthetic transaction and receipt behavior.
- Enabled preview manual pass: real Google OAuth return, recorded public-access policy, isolated Supabase persistence, and server-side OpenAI credential.

## Release gate

- Focused preview contracts pass in Red → Green → Refactor order.
- `npm run verify` passes without skipping the live AI eval or any desktop/mobile Playwright project.
- No production Supabase secret name appears in the preview job.
- No provider credential value appears in `dist`, logs, command-line arguments, comments, or summaries.
- External preview activation uses the approved zero-cost public-access decision; Access remains off because its checkout required a payment method and overage authorization.
