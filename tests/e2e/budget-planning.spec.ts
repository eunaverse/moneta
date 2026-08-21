import { expect, test } from "@playwright/test";
import { openApp, openPrimaryView } from "./helpers";

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await openPrimaryView(page, "Budget");
});

test("adds a budget and updates its amount", async ({ page }) => {
  await page.getByLabel("Category to add to budgets").selectOption({ label: "Insurance & Health" });
  await page.getByRole("button", { name: "Add budget" }).click();
  const budget = page.getByLabel("Insurance & Health expected monthly budget");
  await expect(budget).toBeVisible();
  await budget.fill("725");
  await expect(budget).toHaveValue("725");
});

test("creates a bounded monthly payment, filters it, and links actual spending", async ({ page }) => {
  await page.getByRole("button", { name: "Manage scheduled payments" }).click();
  const schedule = page.locator(".recurring-form");
  await schedule.getByLabel("Name").fill("Gym membership");
  await schedule.getByLabel("Amount").fill("80");
  const start = schedule.getByLabel("First charge month");
  const month = await start.inputValue();
  await schedule.getByLabel("End month · optional").fill(month);
  await schedule.getByRole("button", { name: /Add monthly payment/ }).click();
  await expect(page.locator(".fixed-cost-full-list").getByText("Gym membership", { exact: true })).toBeVisible();
  await page.getByRole("group", { name: "Filter scheduled payments" }).getByRole("button", { name: "Monthly" }).click();
  await expect(page.getByText("Gym membership", { exact: true })).toBeVisible();

  await openPrimaryView(page, "Transactions");
  const form = page.locator(".transaction-form");
  await form.getByRole("button", { name: "Enter manually" }).click();
  await form.getByLabel("Count toward monthly budget").uncheck();
  await form.getByLabel("Link to a scheduled cost").check();
  await form.getByLabel("Scheduled payment").selectOption({ index: 1 });
  await form.getByRole("button", { name: /Save transaction/ }).click();
  await expect(page.getByText(/Plan .* paid/)).toBeVisible();
});
