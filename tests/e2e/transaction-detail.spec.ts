import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow, openApp, openPrimaryView } from "./helpers";

const mixedReceiptDraft = {
  draft: {
    date: "2026-08-19",
    type: "expense",
    category: "Food",
    description: "Target",
    amount: 30,
    currency: "USD",
    countsTowardMonthlyBudget: true,
    allocations: [
      { description: "Milk", category: "Food", amount: 5 },
      { description: "Storage bin", category: "Shopping", amount: 25 },
    ],
  },
  needsReview: [],
  allocationNeedsReview: [[], []],
};

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await openPrimaryView(page, "Transactions");
});

async function saveMixedReceipt(page: Page) {
  await page.route("**/api/transactions/parse", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(mixedReceiptDraft),
  }));
  const form = page.locator(".transaction-form");
  await form.getByLabel("Describe this transaction").fill("A mixed Target receipt");
  await form.getByRole("button", { name: "Create AI draft" }).click();
  await form.getByRole("button", { name: "Save transaction" }).click();
  await expect(page.locator(".transaction-list")).toContainText("Target");
}

async function saveManualTransaction(page: Page) {
  const form = page.locator(".transaction-form");
  await form.getByRole("button", { name: "Enter manually" }).click();
  await form.getByLabel("Description").fill("Groceries");
  await form.getByLabel("Amount").fill("12.50");
  await form.getByRole("button", { name: "Save transaction" }).click();
  await expect(page.locator(".transaction-list")).toContainText("Groceries");
}

test("opens an itemized receipt detail with allocations and a reconciled total", async ({ page }) => {
  await saveMixedReceipt(page);

  const opener = page.getByRole("button", { name: "View details for Target" });
  await opener.click();
  const detail = page.getByRole("dialog", { name: "Target" });

  await expect(detail).toBeVisible();
  await expect(detail.getByText("2026-08-19", { exact: true })).toBeVisible();
  await expect(detail.getByText("USD", { exact: true })).toBeVisible();
  await expect(detail.getByText("Food · Shopping", { exact: true })).toBeVisible();
  await expect(detail.getByText("$30.00", { exact: true }).first()).toBeVisible();

  const items = detail.locator(".transaction-detail-item");
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText("Milk");
  await expect(items.nth(0)).toContainText("Food");
  await expect(items.nth(0)).toContainText("$5.00");
  await expect(items.nth(1)).toContainText("Storage bin");
  await expect(items.nth(1)).toContainText("Shopping");
  await expect(items.nth(1)).toContainText("$25.00");
  await expect(detail.getByText("Item total $30.00 matches receipt total $30.00.")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  expect(await detail.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

  const closeButton = detail.getByRole("button", { name: "Close transaction details" });
  const editButton = detail.getByRole("button", { name: "Edit transaction" });
  await expect(closeButton).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(editButton).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(closeButton).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(detail).toBeHidden();
  await expect(opener).toBeFocused();
});

test("opens a legacy single-category transaction from recent activity and enters edit mode", async ({ page }) => {
  await saveManualTransaction(page);
  await openPrimaryView(page, "Overview");

  await page.getByRole("button", { name: "View details for Groceries" }).click();
  const detail = page.getByRole("dialog", { name: "Groceries" });
  const summaryItem = detail.locator(".transaction-detail-item");

  await expect(summaryItem).toHaveCount(1);
  await expect(summaryItem).toContainText("Groceries");
  await expect(summaryItem).toContainText("Food");
  await expect(summaryItem).toContainText("$12.50");
  await expect(detail.getByText("Summary total $12.50 matches transaction total $12.50.")).toBeVisible();

  await detail.getByRole("button", { name: "Edit transaction" }).click();
  await expect(detail).toBeHidden();
  await expect(page.getByRole("heading", { name: "Edit transaction" })).toBeVisible();
  await expect(page.locator(".transaction-form").getByLabel("Description")).toHaveValue("Groceries");
});

test("keeps detail opening separate from transaction selection", async ({ page }) => {
  await saveManualTransaction(page);
  await page.locator(".transaction-list").getByRole("button", { name: "Select" }).click();

  await expect(page.getByRole("checkbox", { name: "Select Groceries" })).toBeVisible();
  await expect(page.getByRole("button", { name: "View details for Groceries" })).toBeDisabled();
  await expect(page.getByRole("dialog", { name: "Groceries" })).toHaveCount(0);
});
