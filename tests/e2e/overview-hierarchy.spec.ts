import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";

test.beforeEach(async ({ page }) => openApp(page));

test("safe monthly spend stays visually primary over supporting net worth", async ({ page }) => {
  await page.getByRole("button", { name: "Edit assets" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit assets & rates" });
  await dialog.getByRole("button", { name: "Add asset" }).click();
  await dialog.getByLabel("Asset 1 name").fill("Checking");
  await dialog.getByLabel("Asset 1 amount").fill("25000");
  await dialog.getByRole("button", { name: "Save balances" }).click();

  const planAnchor = page.locator(".overview-plan-anchor");
  const netWorth = page.locator(".wealth-overview-card");
  await expect(planAnchor).toContainText("SAFE MONTHLY SPEND");
  await expect(netWorth).toContainText("CURRENT NET WORTH");

  const hierarchy = await page.evaluate(() => {
    const plan = document.querySelector<HTMLElement>(".overview-plan-anchor h2");
    const wealth = document.querySelector<HTMLElement>(".wealth-overview-heading strong");
    const planCard = document.querySelector<HTMLElement>(".overview-plan-anchor");
    const wealthCard = document.querySelector<HTMLElement>(".wealth-overview-card");
    if (!plan || !wealth || !planCard || !wealthCard) throw new Error("Overview hierarchy elements missing");
    const planStyle = getComputedStyle(plan);
    const wealthStyle = getComputedStyle(wealth);
    const planCardStyle = getComputedStyle(planCard);
    const wealthCardStyle = getComputedStyle(wealthCard);
    return {
      planSize: Number.parseFloat(planStyle.fontSize),
      wealthSize: Number.parseFloat(wealthStyle.fontSize),
      planBorderLeft: Number.parseFloat(planCardStyle.borderLeftWidth),
      wealthBackground: wealthCardStyle.backgroundColor,
      wealthShadow: wealthCardStyle.boxShadow,
    };
  });

  expect(hierarchy.planSize).toBeGreaterThanOrEqual(hierarchy.wealthSize * 1.15);
  expect(hierarchy.planBorderLeft).toBeLessThanOrEqual(2);
  expect(hierarchy.wealthBackground).toBe("rgb(255, 255, 255)");
  expect(hierarchy.wealthShadow).toBe("none");
});
