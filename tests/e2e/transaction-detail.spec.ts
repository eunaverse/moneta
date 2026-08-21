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

const multiCategoryReceiptDraft = {
  draft: {
    date: "2026-08-20",
    type: "expense",
    category: "Shopping",
    description: "Target",
    amount: 40.11,
    currency: "USD",
    countsTowardMonthlyBudget: true,
    allocations: [
      { description: "GG VEG", category: "Food", amount: 1.59 },
      { description: "GG CHEESE", category: "Food", amount: 2.19 },
      { description: "Air Wick 디퓨저", category: "Shopping", amount: 13.89 },
      { description: "Conair 빗", category: "Shopping", amount: 5.29 },
      { description: "Up & Up 매니큐어 리무버", category: "Shopping", amount: 1.29 },
      { description: "Sally Hansen 매니큐어", category: "Shopping", amount: 6.39 },
      { description: "Nail Polish 매니큐어", category: "Shopping", amount: 6.39 },
      { description: "Illinois sales tax", category: "Other", amount: 3.08 },
    ],
  },
  needsReview: [],
  allocationNeedsReview: [[], [], [], [], [], [], [], []],
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

async function saveMultiCategoryReceipt(page: Page) {
  await page.route("**/api/transactions/parse", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(multiCategoryReceiptDraft),
  }));
  const form = page.locator(".transaction-form");
  await form.getByLabel("Describe this transaction").fill("A multi-category Target receipt");
  await form.getByRole("button", { name: "Create AI draft" }).click();
  await form.getByRole("button", { name: "Save transaction" }).click();
  await expect(page.locator(".transaction-list")).toContainText("Target");
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

test("aligns item columns and summarizes allocation totals by category", async ({ page }, testInfo) => {
  await saveMultiCategoryReceipt(page);
  await page.getByRole("button", { name: "View details for Target" }).click();

  const detail = page.getByRole("dialog", { name: "Target" });
  const items = detail.locator(".transaction-detail-item");
  await expect(items).toHaveCount(8);

  const categoryTotals = detail.getByRole("region", { name: "Category totals" });
  await expect(categoryTotals).toBeVisible();
  const totals = categoryTotals.locator(".transaction-detail-category-total");
  await expect(totals).toHaveCount(3);
  await expect(totals.nth(0)).toContainText("Food");
  await expect(totals.nth(0)).toContainText("2 items");
  await expect(totals.nth(0)).toContainText("$3.78");
  await expect(totals.nth(1)).toContainText("Shopping");
  await expect(totals.nth(1)).toContainText("5 items");
  await expect(totals.nth(1)).toContainText("$33.25");
  await expect(totals.nth(2)).toContainText("Other");
  await expect(totals.nth(2)).toContainText("1 item");
  await expect(totals.nth(2)).toContainText("$3.08");

  const categoriesStayInsideTheirRows = await items.evaluateAll((rows) => rows.every((row) => {
    const category = row.children[1];
    const rowRect = row.getBoundingClientRect();
    const categoryRect = category.getBoundingClientRect();
    return categoryRect.left >= rowRect.left - 1 && categoryRect.right <= rowRect.right + 1;
  }));
  expect(categoriesStayInsideTheirRows).toBe(true);

  if (testInfo.project.name === "desktop-chromium") {
    const categoryColumns = await items.locator(":scope > span").evaluateAll((labels) => labels.map((label) => {
      const rect = label.getBoundingClientRect();
      return { left: rect.left, width: rect.width };
    }));
    expect(Math.max(...categoryColumns.map(({ left }) => left)) - Math.min(...categoryColumns.map(({ left }) => left))).toBeLessThanOrEqual(1);
    expect(Math.max(...categoryColumns.map(({ width }) => width)) - Math.min(...categoryColumns.map(({ width }) => width))).toBeLessThanOrEqual(1);
  }

  await expect(detail.getByText("Item total $40.11 matches receipt total $40.11.")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  expect(await detail.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
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
  const categoryTotal = detail.getByRole("region", { name: "Category totals" }).locator(".transaction-detail-category-total");
  await expect(categoryTotal).toHaveCount(1);
  await expect(categoryTotal).toContainText("Food");
  await expect(categoryTotal).toContainText("1 item");
  await expect(categoryTotal).toContainText("$12.50");
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
