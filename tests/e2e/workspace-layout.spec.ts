import { expect, test } from "@playwright/test";
import { openApp, openPrimaryView } from "./helpers";

test.beforeEach(async ({ page }) => openApp(page));

test("transaction entry keeps a readable 40:60 workspace balance", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "desktop workspace ratio");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openPrimaryView(page, "Transactions");

  const layout = page.locator(".transaction-layout");
  const formBox = await page.locator(".transaction-form").boundingBox();
  const layoutBox = await layout.boundingBox();
  expect(formBox).not.toBeNull();
  expect(layoutBox).not.toBeNull();
  expect((formBox?.width ?? 0) / (layoutBox?.width ?? 1)).toBeGreaterThanOrEqual(0.39);
  expect((formBox?.width ?? 0) / (layoutBox?.width ?? 1)).toBeLessThanOrEqual(0.43);

  await page.setViewportSize({ width: 1200, height: 1000 });
  await expect.poll(() => layout.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(1);
});

test("settings gives structural controls enough width without collisions", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "desktop and medium settings layout");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openPrimaryView(page, "Settings");

  const gridBox = await page.locator(".settings-grid").boundingBox();
  const currencyBox = await page.locator(".currency-setting").boundingBox();
  expect(gridBox).not.toBeNull();
  expect(currencyBox).not.toBeNull();
  expect((currencyBox?.width ?? 0) / (gridBox?.width ?? 1)).toBeGreaterThanOrEqual(0.95);

  const currencyCopy = await page.locator(".currency-setting > div:nth-child(2)").boundingBox();
  const currencyControl = await page.getByLabel("Primary display currency").boundingBox();
  expect(currencyCopy).not.toBeNull();
  expect(currencyControl).not.toBeNull();
  expect(currencyCopy?.right ?? 0).toBeLessThanOrEqual(currencyControl?.x ?? 0);

  await page.setViewportSize({ width: 1100, height: 1000 });
  const assetsBox = await page.locator(".settings-grid > article").nth(0).boundingBox();
  const categoriesBox = await page.locator(".settings-grid > article").nth(1).boundingBox();
  expect(assetsBox).not.toBeNull();
  expect(categoriesBox).not.toBeNull();
  expect(categoriesBox?.y ?? 0).toBeGreaterThan((assetsBox?.y ?? 0) + (assetsBox?.height ?? 0));
});
