import { expect, type Page } from "@playwright/test";

export async function openApp(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Make your money last/ })).toBeVisible();
}

export async function openPrimaryView(page: Page, name: string) {
  const sidebar = page.locator(".sidebar");
  if (await sidebar.isVisible()) {
    await sidebar.locator("nav button").filter({ hasText: name }).click();
  } else {
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("dialog", { name: "Main navigation" }).locator("nav button").filter({ hasText: name }).click();
  }
}

export async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}
