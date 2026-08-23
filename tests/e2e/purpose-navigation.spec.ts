import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

test.beforeEach(async ({ page }) => openApp(page));

async function primaryNavigation(page: Page) {
  const sidebar = page.locator(".sidebar");
  if (await sidebar.isVisible()) return sidebar.locator("nav");
  await page.getByRole("button", { name: "Open menu" }).click();
  return page.getByRole("dialog", { name: "Main navigation" }).locator("nav");
}

test("primary navigation uses user tasks instead of internal feature names", async ({ page }) => {
  const navigation = await primaryNavigation(page);
  await expect(navigation.locator(".nav-label")).toHaveText([
    "Overview",
    "Transactions",
    "Budget",
    "Try a scenario",
    "Spending insights",
    "Plan setup",
  ]);

  await navigation.getByRole("button", { name: /Try a scenario/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Try a scenario" })).toBeVisible();

  const nextNavigation = await primaryNavigation(page);
  await nextNavigation.getByRole("button", { name: /Spending insights/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Spending insights" })).toBeVisible();
});

test("plan setup separates calculation inputs from preferences and account controls", async ({ page }) => {
  const navigation = await primaryNavigation(page);
  await navigation.getByRole("button", { name: /Plan setup/ }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Plan setup" })).toBeVisible();
  const foundation = page.locator(".plan-foundation-section");
  await expect(foundation).toContainText("Balances & income");
  await expect(foundation).toContainText("Spending categories");
  await expect(foundation).toContainText("When should this money last?");

  const preferences = page.locator(".preference-settings-section");
  await expect(preferences).toContainText("Display & plan currency");
  await expect(preferences).toContainText("Navigation language");
  await expect(preferences).toContainText("Download your data");
  await expect(preferences).toContainText("ACCOUNT");

  const foundationBox = await foundation.boundingBox();
  const preferencesBox = await preferences.boundingBox();
  expect(foundationBox).not.toBeNull();
  expect(preferencesBox).not.toBeNull();
  expect(preferencesBox?.y ?? 0).toBeGreaterThan((foundationBox?.y ?? 0) + (foundationBox?.height ?? 0));
});
