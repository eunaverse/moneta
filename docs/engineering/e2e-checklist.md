# Moneta full-feature E2E checklist

This checklist protects every user-facing workspace, its important state changes, and layout stability. The executable source of truth is `tests/e2e/feature-inventory.mjs`.

## Required viewports

- Desktop Chromium: 1280 × 720 or Playwright Desktop Chrome default
- Mobile Chromium: Pixel 7 profile

## Journeys

- Overview: net worth, monthly budget, recent activity, asset editor, and add-transaction CTA
- Transactions: expense/income creation, edit, filters, selection deletion, undo, scheduled-payment link, and receipt validation
- Budget: flexible categories, amount edits, monthly and one-time schedules, start/end period, filters, and edit path
- What-if: preview state, reset, and conversion to a one-time scheduled payment
- Insights: period control, empty/populated signals, trend, and category limit state
- Settings: balances, exchange rate, forecast horizon, category management, backup export/import validation, and account state
- Navigation: desktop sidebar, mobile drawer, floating CTA, and all nested views

## Global assertions

- Primary heading and CTA are visible and usable.
- The page has no horizontal overflow, clipped primary action, or blocked scrolling.
- Empty and populated states are both exercised where applicable.
- A failed receipt or backup input gives explicit feedback.
- Desktop and mobile projects both run the complete suite; mobile-specific drawer behavior has an additional assertion.

## Release gate

`npm run verify` must pass lint, production build, all Node unit/contract tests, every required live AI output eval, and all Playwright tests. Pull requests and production deployment run the same command.
