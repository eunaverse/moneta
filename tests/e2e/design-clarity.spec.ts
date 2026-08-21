import { expect, test } from "@playwright/test";
import { openApp, openPrimaryView } from "./helpers";

test.beforeEach(async ({ page }) => openApp(page));

test("empty account explains the setup path before presenting projections", async ({ page }) => {
  const setupGuide = page.locator(".setup-guide");
  await expect(setupGuide.getByRole("heading", { name: "Set up a trustworthy plan" })).toBeVisible();
  await expect(setupGuide).toContainText("Add assets & income");
  await expect(setupGuide).toContainText("Review plan dates");
  await expect(setupGuide).toContainText("Add scheduled payments");
  await expect(setupGuide).toContainText("Record a transaction");

  await expect(page.getByRole("heading", { name: "This month's category budgets" })).toBeVisible();
  await expect(page.locator(".overview-plan-anchor")).toContainText("SAFE MONTHLY SPEND");
  await expect(page.locator(".overview-budget-card")).toContainText("No category budget yet");
});

test("planning terms stay distinct and no-data insights remain neutral", async ({ page }) => {
  await openPrimaryView(page, "Budget");
  await expect(page.getByText("SAFE MONTHLY SPEND", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Monthly category budget" })).toBeVisible();

  await openPrimaryView(page, "What-if");
  await expect(page.locator(".scenario-breakdown")).toContainText("Monthly category budget");

  await openPrimaryView(page, "Insights");
  await expect(page.locator(".insight-plan-kicker")).toContainText("SAFE MONTHLY SPEND");
  const action = page.locator(".insights-empty-state");
  await expect(action).toContainText("Add a transaction to unlock spending insights");
  await expect(action).not.toContainText("Room under limits");
  await expect(page.locator(".trend-card, .insight-kpis, .over-limit-panel")).toHaveCount(0);
});

test("language choice honestly discloses partial Korean coverage", async ({ page }) => {
  await openPrimaryView(page, "Settings");
  await expect(page.locator(".settings-language")).toContainText("Detailed tools remain in English");
  await expect(page.getByRole("button", { name: /한국어.*부분 지원/ })).toBeVisible();
});

test("mobile quick add lives in the header and never overlays navigation or dialogs", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "mobile-only interaction");

  const quickAdd = page.getByRole("button", { name: "Add transaction" });
  await expect(page.locator(".mobile-header").getByRole("button", { name: "Add transaction" })).toBeVisible();
  await expect(page.locator(".mobile-transaction-fab")).toHaveCount(0);

  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(page.getByRole("dialog", { name: "Main navigation" })).toBeVisible();
  await expect(quickAdd).toBeHidden();
  await page.getByRole("button", { name: "Close menu" }).click();

  await page.getByRole("button", { name: "Edit assets" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit assets & rates" });
  await expect(dialog).toBeVisible();
  await expect(quickAdd).toBeHidden();
  await expect(dialog.getByRole("button", { name: "Save balances" })).toBeVisible();
});

test("key financial labels meet the desktop readability floor", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "desktop readability regression");
  for (const selector of [
    ".overview-plan-anchor > div:first-child > span",
    ".overview-plan-anchor p",
    ".wealth-overview-values span",
    ".overview-budget-empty span",
  ]) {
    const fontSize = await page.locator(selector).first().evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
    expect(fontSize, selector).toBeGreaterThanOrEqual(12);
  }
});
