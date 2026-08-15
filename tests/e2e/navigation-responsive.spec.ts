import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, openApp, openPrimaryView } from "./helpers";

test("opens every primary workspace and preserves layout", async ({ page }) => {
  await openApp(page);
  for (const name of ["Transactions", "Budget", "What-if", "Insights", "Settings", "Overview"]) {
    await openPrimaryView(page, name);
    await expect(page.getByRole("heading", { name: name === "Overview" ? /Your money/ : name, level: 1 })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }
});

test("mobile drawer and floating transaction action remain usable", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "mobile-only interaction");
  await openApp(page);
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(page.getByRole("dialog", { name: "Main navigation" })).toBeVisible();
  await page.getByRole("button", { name: "Close menu" }).click();
  await page.locator(".mobile-transaction-fab").click();
  await expect(page.getByRole("heading", { name: "Add a transaction" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
