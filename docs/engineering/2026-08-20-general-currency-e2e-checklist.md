# General currency and database-owned defaults E2E checklist

## Purpose

Protect the flows that let a new or existing Moneta user:

- start from their saved financial values instead of sample money amounts;
- choose a primary display currency, with USD as the new-account default;
- keep assets and transactions in other currencies and convert them with user-entered rates;
- understand and resolve a missing exchange rate before trusting net worth or forecasts;
- download a backup without exposing the removed import control.

## Required viewports

- Small mobile: Pixel 7 project from `playwright.config.ts`.
- Medium: 768 × 1024 for the expanded asset and exchange-rate editor.
- Large desktop: Desktop Chrome project from `playwright.config.ts`.

## Global checks

- The Overview, Transactions, Budget, and Settings headings load without browser errors.
- Primary actions remain visible, clickable, and inside the viewport.
- Currency codes, rate labels, and formatted amounts do not clip or overlap.
- No horizontal overflow appears after adding multiple asset rows or exchange-rate controls.
- Long currency names wrap without hiding amount inputs, selectors, save buttons, or warnings.

## User journeys

### New account uses only database-owned amounts

- Open a new E2E account with no remote state.
- Confirm the primary display currency is USD.
- Confirm current net worth and monthly category budget are both $0.
- Confirm Housing, Food, and Transport sample amounts are not active budgets.
- Add a budget explicitly and confirm only the entered amount contributes to the total.

### Foreign asset conversion

- Open the asset editor and add an asset.
- Enter a name and balance, then choose a non-USD currency.
- Confirm a rate control appears using the direction `1 USD = rate foreign currency`.
- Enter the rate and save.
- Confirm Overview converts the asset into USD and exposes the original amount in the account breakdown.
- Change the rate and confirm net worth recalculates from the user-entered value.

### Missing-rate protection

- Choose a foreign currency without entering a positive rate.
- Confirm the editor explains which rate is missing.
- Confirm Save is disabled so Moneta does not silently treat foreign money as USD or as zero.
- Enter a valid rate and confirm the warning clears and Save becomes available.

### General transaction currency

- Configure a foreign currency rate.
- Record an income or expense in that currency.
- Confirm the row preserves the original currency and the monthly totals use the converted display-currency value.
- Edit the transaction and confirm its currency remains selected.

### Display currency and backup settings

- Confirm USD is the default display currency for a new account.
- Choose another supported display currency while no money is entered and confirm primary amounts use it.
- Confirm `Download backup` remains available.
- Confirm no Import button or JSON upload input is rendered.

## State coverage

- Empty: zero assets, zero active budgets, no schedules, no transactions.
- Populated: multiple assets in the display currency and at least one foreign currency.
- Validation error: foreign currency selected with missing or zero rate.
- Migrated: legacy KRW/USD balances and a custom category budget are preserved.
- Seed cleanup: the untouched legacy sample budget signature is removed once.
- Saved: reloading keeps display currency, assets, exchange rates, and transaction currencies.

## Responsive and visual stability

- Asset rows stack on small mobile without clipping name, amount, currency, or remove controls.
- The medium viewport keeps rate labels adjacent to their inputs without horizontal scrolling.
- Settings cards do not overflow when currency names or ISO codes are long.
- Capture and manually inspect Overview, the populated asset editor, and Settings on mobile and desktop.

## Test buckets

- `tests/moneta-state.test.mjs`: snapshot migration, empty defaults, and currency conversion contracts.
- `tests/e2e/currency-settings.spec.ts`: new-account defaults, asset conversion, missing-rate validation, display currency, backup-only settings, and responsive layout.
- `tests/e2e/currency-settings.spec.ts`: transaction creation in a configured foreign currency and converted monthly totals.
- `tests/rendered-html.test.mjs`: static contracts preventing legacy KRW/USD fields and Import UI from returning.

## Release gate

- New unit and E2E contracts fail before implementation and pass afterward.
- `tests/e2e/feature-inventory.mjs` points every new behavior to an executable spec.
- `npm run verify` passes lint, production build, all unit/contract tests, and desktop/mobile E2E.
- Mobile, medium, and desktop currency screens have no clipping, overlap, hidden controls, or overflow.
