import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, openApp, openPrimaryView } from "./helpers";

test.beforeEach(async ({ page }) => openApp(page));

test("empty overview gives a direct first transaction action", async ({ page }) => {
  const emptyState = page.locator(".overview-transaction-preview");
  await expect(emptyState.getByText("No transactions yet")).toBeVisible();
  await emptyState.getByRole("button", { name: "Add your first transaction" }).click();
  await expect(page.getByRole("heading", { name: "Add a transaction" })).toBeVisible();
});

test("budget separates monthly planning from scheduled payments", async ({ page }) => {
  await openPrimaryView(page, "Budget");
  await expect(page.getByRole("heading", { name: "Expected budgets" })).toBeVisible();
  await expect(page.locator(".recurring-form")).toHaveCount(0);
  await page.getByRole("button", { name: "Manage scheduled payments" }).click();
  await expect(page.getByRole("heading", { name: "Scheduled payments", level: 1 })).toBeVisible();
  await expect(page.locator(".recurring-form")).toBeVisible();
});

test("money fields format large values and use explicit save copy", async ({ page }) => {
  await page.getByRole("button", { name: "Edit assets" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit assets & income" });
  const primaryAccount = dialog.getByLabel("Primary KRW account");
  await primaryAccount.fill("76000000");
  await expect(primaryAccount).toHaveValue("76,000,000");
  await expect(dialog.getByRole("button", { name: "Save balances" })).toBeVisible();
});

test("Korean interface preference translates the main workspace", async ({ page }) => {
  await openPrimaryView(page, "Settings");
  await page.getByRole("button", { name: "한국어" }).click();
  await expect(page.getByRole("heading", { name: "설정", level: 1 })).toBeVisible();
  if (await page.getByRole("button", { name: "Open menu" }).isVisible()) await page.getByRole("button", { name: "Open menu" }).click();
  await expect(page.getByRole("button", { name: /거래 내역/ }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "설정", level: 1 })).toBeVisible();
});

test("mobile what-if shows the verdict before the prepare action", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "mobile-only interaction");
  await openPrimaryView(page, "What-if");
  await page.getByLabel("One-time purchase").fill("100000");
  await expect(page.locator(".scenario-mobile-verdict")).toContainText("NOT RECOMMENDED");
  const verdict = page.locator(".scenario-result");
  const prepare = page.getByRole("button", { name: /Prepare as one-time payment/ });
  await expect(verdict.getByText("NOT RECOMMENDED", { exact: true })).toBeVisible();
  const verdictBox = await verdict.boundingBox();
  const prepareBox = await prepare.boundingBox();
  expect(verdictBox?.y).toBeLessThan(prepareBox?.y ?? 0);
  await expectNoHorizontalOverflow(page);
});

test("core mobile controls and copy meet touch and readability floors", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "mobile-only interaction");
  const menuBox = await page.getByRole("button", { name: "Open menu" }).boundingBox();
  expect(menuBox?.width).toBeGreaterThanOrEqual(44);
  expect(menuBox?.height).toBeGreaterThanOrEqual(44);
  const paragraphSize = await page.locator(".overview-page .clarity-note").evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
  expect(paragraphSize).toBeGreaterThanOrEqual(16);
});
