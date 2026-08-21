import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, openApp, openPrimaryView } from "./helpers";

test.beforeEach(async ({ page }) => openApp(page));

test("overview leads with the plan outcome and treats zero as setup, not loss", async ({ page }) => {
  await expect(page.getByRole("heading", { level: 1, name: /Make your money last/ })).toBeVisible();

  const planAnchor = page.locator(".overview-plan-anchor");
  await expect(planAnchor).toContainText("SAFE MONTHLY SPEND");
  await expect(planAnchor).toContainText("Add money to calculate");

  const planBox = await planAnchor.boundingBox();
  const wealthBox = await page.locator(".wealth-overview-card").boundingBox();
  expect(planBox).not.toBeNull();
  expect(wealthBox).not.toBeNull();
  expect(planBox!.y).toBeLessThan(wealthBox!.y);

  await expect(page.locator(".wealth-overview-card")).toHaveClass(/empty/);
  await expect(page.locator(".wealth-track")).toHaveClass(/empty/);
  await expect(page.locator(".overview-transaction-preview").getByRole("button", { name: /View all/ })).toHaveCount(0);
});

test("empty planning screens show one next action instead of inactive analysis controls", async ({ page }) => {
  await openPrimaryView(page, "Budget");
  await expect(page.locator(".category-budget-empty")).toContainText("Add your first category budget");
  await expect(page.locator(".category-heading-actions")).toHaveCount(0);
  await expect(page.locator(".budget-donut-panel")).toHaveCount(0);

  await openPrimaryView(page, "Insights");
  const emptyState = page.locator(".insights-empty-state");
  await expect(emptyState).toContainText("Add a transaction to unlock spending insights");
  await expect(emptyState.getByRole("button", { name: "Add first transaction" })).toBeVisible();
  await expect(page.locator(".trend-card, .insight-kpis, .over-limit-panel")).toHaveCount(0);
});

test("new transactions offer one entry method at a time", async ({ page }) => {
  await openPrimaryView(page, "Transactions");
  const form = page.locator(".transaction-form");
  const method = form.getByRole("group", { name: "Entry method" });

  await expect(method.getByRole("button", { name: "Describe with AI" })).toHaveAttribute("aria-pressed", "true");
  await expect(form.getByLabel("Describe this transaction")).toBeVisible();
  await expect(form.getByLabel("Description", { exact: true })).toBeHidden();

  await method.getByRole("button", { name: "Enter manually" }).click();
  await expect(method.getByRole("button", { name: "Enter manually" })).toHaveAttribute("aria-pressed", "true");
  await expect(form.getByLabel("Describe this transaction")).toBeHidden();
  await expect(form.getByLabel("Description", { exact: true })).toBeVisible();

  await expect(page.locator(".transaction-list").getByRole("button", { name: "Select" })).toHaveCount(0);
  await expect(page.locator(".transaction-list").getByRole("button", { name: /View all/ })).toHaveCount(0);
  await expect(page.locator(".compact-summary")).toHaveCount(0);
});

test("settings explains autosave and the impact of changing the primary currency", async ({ page }) => {
  await openPrimaryView(page, "Settings");
  await expect(page.locator(".settings-save-note")).toContainText("Changes save automatically");
  await expect(page.locator(".currency-setting")).toContainText("Assets and transactions keep their original currency");
});

test("mobile workspaces keep full page names and readable supporting text", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "mobile-only readability contract");

  await openPrimaryView(page, "Transactions");
  const currentPage = page.locator(".mobile-current-page");
  await expect(currentPage).toHaveText("Transactions");
  expect(await currentPage.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

  for (const selector of [
    ".transaction-ai-heading p",
    ".transaction-ai-actions > small",
  ]) {
    const size = await page.locator(selector).first().evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
    expect(size, selector).toBeGreaterThanOrEqual(12);
  }
  await expectNoHorizontalOverflow(page);
});
