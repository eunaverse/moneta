import { expect, test } from "@playwright/test";
import { openApp, openPrimaryView } from "./helpers";

test.beforeEach(async ({ page }) => openApp(page));

test("previews a what-if purchase and prepares a one-time payment", async ({ page }) => {
  await openPrimaryView(page, "What-if");
  await expect(page.getByText("PLAN END DATE", { exact: true })).toBeVisible();
  await expect(page.getByText("Simulation period", { exact: true })).toHaveCount(0);
  await page.getByLabel("One-time purchase").fill("500");
  await expect(page.locator(".scenario-result")).toBeVisible();
  await expect(page.getByLabel("What-if calculation breakdown")).toContainText("What-if one-time purchase");
  await expect(page.getByText(/ESTIMATED BALANCE AT PLAN END/)).toBeVisible();
  await page.getByRole("button", { name: /Prepare as one-time payment/ }).click();
  await expect(page.getByRole("heading", { name: "Scheduled payments", level: 1 })).toBeVisible();
  await expect(page.locator(".recurring-form").getByLabel("Name")).toHaveValue("What-if purchase");
});

test("edits assets, the fixed plan period, and insights period", async ({ page }) => {
  await page.getByRole("button", { name: "Edit assets" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit assets & rates" });
  await dialog.getByRole("button", { name: "Add asset" }).click();
  await dialog.getByLabel("Asset 1 name").fill("Checking");
  await dialog.getByLabel("Asset 1 amount").fill("10000");
  await dialog.getByRole("button", { name: "Save balances" }).click();
  await expect(page.getByText("$10,000", { exact: true }).first()).toBeVisible();

  await openPrimaryView(page, "Settings");
  await page.getByLabel("Planning end month").fill("2099-12");
  await expect(page.getByLabel("Planning end month")).toHaveValue("2099-12");
  await openPrimaryView(page, "Insights");
  await page.locator(".insight-range-controls").getByRole("spinbutton").fill("12");
  await expect(page.getByText("12 MONTHS", { exact: true })).toBeVisible();
});

test("creates and renames a category and exposes a download-only backup", async ({ page }) => {
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
  await expect(page.getByRole("button", { name: "Download backup" })).toBeVisible();
  await expect(page.locator('input[type="file"][accept*="json"]')).toHaveCount(0);
});
