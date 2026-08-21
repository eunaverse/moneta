# Transaction detail E2E checklist

## Purpose

Protect the saved-transaction detail journey without changing Moneta's one-receipt-per-`LedgerEntry` model. The detail must explain allocation-level category splits, preserve legacy single-category entries, and remain usable alongside edit, receipt-photo, selection, and deletion actions.

## Viewports

- Pixel 7 mobile project: readable modal, working vertical scroll, no horizontal overflow.
- Desktop Chrome project: constrained readable modal and visible actions without clipping.
- Existing 901 px layout-breakpoint coverage remains the narrow-laptop contract for the surrounding transaction workspace.

## Journeys and states

### Itemized receipt detail

- Save one receipt as one transaction with `Milk / Food / $5.00` and `Storage bin / Shopping / $25.00` allocations.
- Open it from Actual activity or All activity.
- Show merchant/description, date, original currency, receipt total, and `Food · Shopping` category summary.
- Show every allocation once with item name, category, and original-currency amount.
- Keep item category and amount columns aligned across rows, including rows with wider amounts.
- Summarize each included category with its item count and allocation total.
- Explain that the item total matches the receipt total.

### Legacy single-category detail

- Save or load an entry without `allocations`.
- Open it from Recent activity.
- Render the entry description, category, and amount as one summary item rather than an empty item list.
- Explain that the summary total matches the transaction total.

### Actions and accessibility

- Close with the close button, backdrop, and Escape.
- Restore keyboard focus to the opener after a normal close.
- Enter the existing edit flow from the detail's Edit action with the saved fields intact.
- While transaction selection mode is active, keep the detail trigger disabled so selection and detail opening cannot compete.
- Keep receipt-photo opening as a distinct action when an attachment exists.

## Responsive and visual checks

- The document and modal have no horizontal overflow.
- Long merchant and item text wrap without clipping category, amount, or actions; category pills stay inside their assigned column.
- The item list and modal scroll vertically when taller than the viewport.
- Close and Edit remain visible and touch-friendly on mobile.
- Manually review the itemized modal once at desktop and Pixel 7 sizes for clipping, overlap, and awkward wrapping.

## Test bucket

- `tests/e2e/transaction-detail.spec.ts`: detail content, aligned allocation columns, category totals, reconciliation, fallback, keyboard close, Edit transition, selection isolation, and responsive overflow.
- `tests/e2e/transactions.spec.ts`: create/edit/delete/undo remains the broader ledger lifecycle contract.
- `tests/e2e/ai-transaction-entry.spec.ts`: allocation creation and one-entry receipt storage remain the AI draft contract.

## Release gate

- Focused transaction-detail Playwright tests pass in desktop and mobile projects.
- Existing receipt, transaction, Budget, and Insights contracts remain green.
- `npm run verify` passes in full before the pull request is created.
