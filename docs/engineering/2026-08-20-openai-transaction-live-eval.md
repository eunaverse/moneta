# OpenAI transaction live eval

## Decision

Use `gpt-5.6-luna` with `reasoning.effort: none` for Moneta's transaction draft extraction.

Luna fits this bounded, high-volume extraction task because it supports image input and strict Structured Outputs at the lowest-cost GPT-5.6 tier. This is a workload-specific choice, not a claim that Luna is the best model for every task.

At the published 2026-08-20 token rates, Luna costs $0.20 per million input tokens and $1.20 per million output tokens. The previously configured Cloudflare Llama 4 Scout costs $0.27 and $0.85 respectively. Moneta's five-case live run used 2,936 input and 291 output tokens, so the raw model cost was about $0.00094 total with Luna versus an estimated $0.00104 at the same token mix with Llama. Cloudflare's daily free allocation can still make very low-volume use free, and the providers may count image inputs differently; the live eval, not price alone, remains the selection gate.

## Representative cases

`tests/ai-transaction-live-eval.mjs` sends synthetic, privacy-safe evidence and grades semantic fields rather than accepting an HTTP 200 or valid JSON alone:

- Korean expense with a relative date, merchant, category, amount, and currency.
- Korean salary income with a relative date and formatted amount.
- A Korean-language EUR expense that verifies compatibility with Moneta's multi-currency workspace.
- An expense with a deliberately missing amount that must remain `null` and require review.
- A generated receipt image with a date, grocery category, line items, tax, and final USD total.

## Baseline captured on 2026-08-20

| Configuration | Result | Input tokens | Output tokens | Duration |
| --- | --- | ---: | ---: | ---: |
| `gpt-5.6-luna`, `reasoning: none` | 5/5 passed | 2,936 | 291 | 5,788 ms |
| `gpt-5.6-luna`, `reasoning: low` | Failed the earlier four-case receipt budget-treatment assertion after 3 passing cases | Not recorded after failure | Not recorded after failure | Not recorded after failure |

The `low` run returned `null` instead of `true` for `countsTowardMonthlyBudget` on the otherwise complete grocery receipt. Because `none` passed every representative case with lower expected reasoning cost, the application and mandatory gate use `none`.

This five-case set is a release gate, not proof of universal receipt accuracy. Add representative cases whenever a new AI behavior, language, currency, image type, or known failure mode is introduced.

## Harness contract

- Mocked unit tests protect request shape, authentication, failures, and deterministic boundaries.
- Mocked Playwright tests protect user review and save behavior.
- The live eval protects actual model semantics and may not be skipped when a credential is missing.
- `tests/ai-feature-inventory.mjs` maps each AI behavior to an executable live eval.
- `npm run verify` runs unit contracts, the live eval, and browser E2E coverage.
