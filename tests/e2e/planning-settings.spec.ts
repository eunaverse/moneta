import { expect, test } from "@playwright/test";
import { openApp, openPrimaryView } from "./helpers";

test.beforeEach(async ({ page }) => openApp(page));

test("previews a what-if purchase and prepares a one-time payment", async ({ page }) => {
  await openPrimaryView(page, "What-if");
  await page.getByLabel("One-time purchase").fill("500");
  await expect(page.locator(".scenario-result")).toBeVisible();
  await page.getByRole("button", { name: /Prepare as one-time payment/ }).click();
  await expect(page.getByRole("heading", { name: "Budget", level: 1 })).toBeVisible();
  await expect(page.locator(".recurring-form").getByLabel("Name")).toHaveValue("What-if purchase");
});

test("edits assets, forecast settings, and insights period", async ({ page }) => {
  await page.getByRole("button", { name: "Edit assets" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit assets & income" });
  await dialog.getByLabel("USD cash").fill("10000");
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText("$10,000", { exact: true }).first()).toBeVisible();

  await openPrimaryView(page, "Settings");
  await page.getByLabel("Forecast months").fill("36");
  await page.getByLabel("KRW per USD").fill("1350");
  await openPrimaryView(page, "Insights");
  await page.locator(".insight-range-controls").getByRole("spinbutton").fill("12");
  await expect(page.getByText("12 MONTHS", { exact: true })).toBeVisible();
});

test("creates and renames a category and rejects an invalid backup", async ({ page }) => {
  await openPrimaryView(page, "Settings");
  await page.getByRole("button", { name: /Manage/ }).click();
  await page.getByLabel("New category name").fill("Pets");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: /Load more/ }).click();
  const category = page.getByLabel("Rename Pets");
  await category.fill("Pet care");
  await category.press("Enter");
  await expect(page.getByLabel("Rename Pet care")).toBeVisible();

  await page.getByRole("button", { name: /Settings/ }).first().click();
  const invalidBackupAlert = page.waitForEvent("dialog");
  await page.locator('input[type="file"][accept="application/json,.json"]').setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"version": 99}'),
  });
  const alert = await invalidBackupAlert;
  expect(alert.message()).toContain("valid Moneta backup");
  await alert.accept();
});
