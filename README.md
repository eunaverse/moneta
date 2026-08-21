# Moneta

A private multi-currency budget dashboard running on
[vinext](https://github.com/cloudflare/vinext) and Cloudflare Workers.

The transaction workspace uses OpenAI GPT-5.6 Luna to turn a purchase
description or payment screenshot into an editable draft. The server verifies
the signed-in Supabase access token before inference, requests strict structured
output, validates every model field against Moneta's transaction schema, and
never saves the draft until the user presses **Save transaction**. The provider
credential stays in a Cloudflare Worker secret and is never shipped to the browser.

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm install
npm run dev
npm run build
```

Production is deployed to `moneta.eunaverse.workers.dev`.

Pushes to `main` run the GitHub Actions workflow in
`.github/workflows/deploy-cloudflare.yml`. The repository must define these
GitHub Actions secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `MONETA_TRANSACTION_AI_TOKEN`

## PR preview

Pull requests run the same complete quality gate before any preview action. An
approved internal PR can then deploy a dedicated PR-scoped Worker named
`pr-<number>-moneta`. That preserves the stable preview URL while keeping the
production `moneta` Worker untouched. Closing the PR deletes the entire preview
Worker. Fork PRs never receive repository secrets and never upload a preview.

Preview deployment uses a dedicated, empty/synthetic Supabase project. The
required repository gates are `PR_PREVIEW_ENABLED=true` and
`PR_PREVIEW_ACCESS_REVIEWED=true`. The current no-cost decision keeps the Worker
preview public because activating Cloudflare Access required payment and overage
authorization. Configuration, narrow Google OAuth redirects, secret handling,
cost findings, exposure controls, and close cleanup are documented in
[`docs/engineering/pr-preview-environments.md`](docs/engineering/pr-preview-environments.md).

## Included Shape

- edit site code under `app/`
- `vite.config.ts` simulates declared bindings for local development
- `db/schema.ts` starts intentionally empty
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

Signed-in visitors receive both `oai-authenticated-user-id` and `oai-authenticated-user-email`. Private Sites require every visitor to sign in; public Sites may also have anonymous visitors, for whom neither header is present.

The user ID is stable for the same user on the same Site and different across Sites. Email and name are intended for display or contact purposes.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const userId = requestHeaders.get("oai-authenticated-user-id");
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs
optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send
  anonymous visitors through Sign in with ChatGPT.
- Use `chatGPTSignInPath(returnTo)` and `chatGPTSignOutPath(returnTo)` for
  browser links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in
  or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because
  they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the
Sites hosting platform's access policy controls for workspace-wide restrictions,
or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write
actions tied to the current ChatGPT user. Leave public content anonymous.

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm run deploy`: build and deploy the `moneta` Worker
- `npm run test:unit`: run Node unit and repository-contract tests
- `npm run test:ai:live`: call the configured model with synthetic text and receipt cases and grade its actual output
- `npm run test:e2e`: run every feature journey in desktop and mobile Chromium
- `npm run verify`: run lint, production build, unit tests, the live AI output eval, and the complete E2E suite
- `npm run pr`: rerun the complete gate, push the topic branch, and create its pull request
- `npm run db:generate`: generate Drizzle migrations after schema changes

`npm run verify` also runs the mandatory live AI output eval, so a server-side
`MONETA_TRANSACTION_AI_TOKEN` (or the standard OpenAI environment variable for
local evaluation) must be available. All changes follow the TDD and pull-request
lifecycle in `AGENTS.md`. Install the Playwright browser once with
`npx playwright install chromium` before the first local E2E run.

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
