# Moneta engineering harness

These rules apply to every code, configuration, documentation, and dependency change.

## Required lifecycle

1. Work on a topic branch. Never commit or push a change directly to `main`.
2. Use **Red → Green → Refactor** TDD:
   - add or update the smallest relevant test first;
   - run it and record the expected failure;
   - implement the smallest passing change;
   - refactor only while the tests stay green.
3. Update `tests/e2e/feature-inventory.mjs` whenever product behavior changes. Every feature entry must point to an executable Playwright spec.
4. Run `npm run verify`. It must pass lint, production build, all unit/contract tests, every required live AI output eval, and the complete desktop/mobile E2E suite.
5. Commit only files belonging to the change, then run `npm run pr`. Every completed change ends in a pull request.

## AI output validation

Any feature that adds or changes model behavior must add or update an entry in `tests/ai-feature-inventory.mjs` and its executable live model output eval. The eval must call the configured production model with synthetic, privacy-safe representative inputs and assert semantic correctness, schema compliance, and uncertainty handling—not merely a successful HTTP response or valid JSON.

Provider-mocked unit and E2E tests remain mandatory for deterministic authorization, error, and UI coverage. Mock tests are not a substitute for live model output evals. `npm run verify` must run both, and a missing provider credential is a failing gate rather than a skipped eval.

Never commit an AI provider credential. Keep it server-side in the deployment secret store.

Do not weaken, skip, or narrow a failing test to make the gate pass. Fix the behavior or document a deliberate product decision in the PR.
