import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, openApp, openPrimaryView } from "./helpers";

test("opens every primary workspace and preserves layout", async ({ page }) => {
  await openApp(page);
  for (const name of ["Transactions", "Budget", "What-if", "Insights", "Settings", "Overview"]) {
    await openPrimaryView(page, name);
    await expect(page.getByRole("heading", { name: name === "Overview" ? /Make your money last/ : name, level: 1 })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }
});

test("mobile header stays focused while the drawer provides transaction navigation", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "mobile-only interaction");
  await openApp(page);
  await expect(page.locator(".mobile-header").getByRole("button", { name: "Add transaction" })).toHaveCount(0);
  await page.getByRole("button", { name: "Open menu" }).click();
  const drawer = page.getByRole("dialog", { name: "Main navigation" });
  await expect(drawer).toBeVisible();
  await drawer.getByRole("button", { name: "Transactions" }).click();
  await expect(page.getByRole("heading", { name: "Add a transaction" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
