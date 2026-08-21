# AI transaction entry E2E checklist

## Purpose

Protect the flow that turns a purchase description or card/receipt image into an editable transaction draft. AI output must never enter the ledger until the user reviews the ordinary transaction fields and presses **Save transaction**.

## Required viewports

- Small mobile: Pixel 7 project in the existing Playwright matrix.
- Breakpoint check: 901 px wide, immediately above Moneta's mobile navigation breakpoint.
- Desktop: the existing Desktop Chrome project.

## Global checks

- The transaction page and AI assistant load without a fatal error.
- The description input, image picker, and **Create AI draft** CTA remain visible and usable.
- Loading, result, review, and error copy does not overlap the form or push actions off screen.
- No horizontal overflow appears at the supported viewports.
- The user can still enter every transaction field manually when AI is unavailable.

## User journeys

### Natural-language draft

- Open Transactions and enter a Korean or English purchase description.
- Press **Create AI draft** and verify a loading state prevents duplicate requests.
- Verify the authenticated request contains the description.
- Verify date, type, category, description, amount, currency, and budget treatment populate the editable form.
- Verify the ledger remains unchanged until **Save transaction** is pressed.
- Save and verify the new transaction appears once.

### Card or receipt screenshot draft

- Choose a supported JPG, PNG, or WEBP image.
- Verify its filename remains visible and the image is sent only after the user presses **Create AI draft**.
- Verify extracted values populate the draft and the selected image remains attached for the later save.
- Reject unsupported or oversized AI images without sending an inference request.

### Incomplete or failed analysis

- Return a draft with at least one missing or uncertain field and name it in the review status.
- Clear missing required values rather than silently retaining stale form data.
- Prevent saving while required fields remain empty.
- On a provider or network failure, show a retryable error and preserve the user's existing manual draft.

## State coverage

- Empty: no description and no image disables analysis.
- Loading: CTA shows progress and cannot send a duplicate request.
- Success: all extracted fields appear in the form, not the ledger.
- Needs review: missing or uncertain fields are listed and remain editable.
- Error: retry guidance is visible and manual entry still works.
- Populated: a successfully reviewed draft can be saved through the existing transaction path.
- Unauthorized: the API rejects missing or invalid Supabase bearer tokens before inference.

## Visual review

Capture and inspect the populated assistant on mobile and desktop. Check textarea wrapping, image filename truncation, status text, button visibility, form spacing, and the transition from AI result to manual fields.

## Test buckets

- `tests/transaction-ai.test.mjs`: API authorization, payload limits, model-output validation, and provider failures.
- `tests/e2e/ai-transaction-entry.spec.ts`: natural-language, image, review-before-save, error, and responsive browser journeys.
- `tests/e2e/transactions.spec.ts`: existing manual CRUD and receipt validation remain regression coverage.

## Release gate

- Focused unit and Playwright contracts pass.
- `tests/e2e/feature-inventory.mjs` maps both AI input journeys to executable coverage.
- `npm run verify` passes without skipped or weakened contracts.
- Mobile and desktop screenshots show no clipping, overlap, hidden CTA, or horizontal overflow.
