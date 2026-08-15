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
4. Run `npm run verify`. It must pass lint, production build, all unit/contract tests, and the complete desktop/mobile E2E suite.
5. Commit only files belonging to the change, then run `npm run pr`. Every completed change ends in a pull request.

Do not weaken, skip, or narrow a failing test to make the gate pass. Fix the behavior or document a deliberate product decision in the PR.
