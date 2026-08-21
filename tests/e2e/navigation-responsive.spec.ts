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

test("mobile drawer and quick-add action keep daily entry within one tap", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "mobile-only interaction");
  await openApp(page);
  const quickAdd = page.getByRole("button", { name: "Add transaction" });
  await expect(quickAdd).toBeVisible();
  const quickAddBox = await quickAdd.boundingBox();
  expect(quickAddBox?.width).toBeGreaterThanOrEqual(44);
  expect(quickAddBox?.height).toBeGreaterThanOrEqual(44);
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(page.getByRole("dialog", { name: "Main navigation" })).toBeVisible();
  await page.getByRole("button", { name: "Close menu" }).click();
  await quickAdd.click();
  await expect(page.getByRole("heading", { name: "Add a transaction" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
