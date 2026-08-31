import { expect, test } from "@playwright/test";
import { openApp, openPrimaryView } from "./helpers";

test("separates the insight range from the live plan and rolls overdue payments forward", async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 7, 31, 23, 59, 55) });
  await openApp(page);

  await openPrimaryView(page, "Budget");
  await page.getByRole("button", { name: "Scheduled payments", exact: true }).click();
  const schedule = page.locator(".recurring-form");
  await schedule.getByRole("button", { name: "One-time" }).click();
  await schedule.getByLabel("Name").fill("Tuition");
  await schedule.getByLabel("Amount").fill("1200");
  await schedule.getByLabel("Payment month").fill("2026-08");
  await schedule.getByRole("button", { name: "Add one-time payment" }).click();

  await openPrimaryView(page, "Insights");
  const insightRange = page.locator(".insight-range-controls");
  await expect(insightRange.getByText("ANALYSIS THROUGH", { exact: true })).toBeVisible();
  await insightRange.getByLabel("Analysis through month").fill("2026-09");
  await expect(page.getByText("CURRENT PLAN TARGET", { exact: true })).toBeVisible();
  await expect(page.getByText("AS OF 2026-08", { exact: true })).toBeVisible();

  await page.clock.fastForward(10_000);

  await expect(page.getByText("AS OF 2026-09", { exact: true })).toBeVisible();
  const calculation = page.locator(".insight-action-card .calculation-tooltip");
  await expect(calculation).toContainText("Tuition · OVERDUE");
  await expect(calculation).toContainText("2026-08");
  await expect(calculation).toContainText("2026-09–2028-07");
  await expect(calculation).toContainText("÷ 23 months");

  await openPrimaryView(page, "Overview");
  const overdue = page.locator(".overdue-scheduled");
  await expect(overdue).toContainText("OVERDUE THROUGH 2026-08");
  await expect(overdue).toContainText("Tuition");
  await expect(overdue).toContainText("$1,200");
});
