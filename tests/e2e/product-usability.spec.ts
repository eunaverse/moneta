import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, openApp, openPrimaryView } from "./helpers";

test.beforeEach(async ({ page }) => openApp(page));

test("overview leads with the plan outcome and treats zero as setup, not loss", async ({ page }) => {
  await expect(page.getByRole("heading", { level: 1, name: /Make your money last/ })).toBeVisible();

  const planAnchor = page.locator(".overview-plan-anchor");
  await expect(planAnchor).toContainText("SAFE MONTHLY SPEND");
  await expect(planAnchor).toContainText("Add money to calculate");

  await expect(page.locator(".overview-title").getByRole("button", { name: /Add transaction/ })).toHaveCount(0);
  await expect(page.locator(".wealth-overview-card")).toHaveCount(0);
  await expect(page.locator(".overview-budget-card")).toHaveCount(0);
  await expect(page.locator(".overview-transaction-preview").getByRole("button", { name: "Add your first transaction" })).toBeVisible();
  await expect(page.locator(".overview-transaction-preview").getByRole("button", { name: /View all/ })).toHaveCount(0);
});

test("overview explains category-budget math without an outside-budget total", async ({ page }) => {
  await openPrimaryView(page, "Budget");
  await page.getByLabel("Category to add to budgets").selectOption({ label: "Insurance & Health" });
  await page.getByRole("button", { name: "Add budget" }).click();
  await page.getByLabel("Insurance & Health expected monthly budget").fill("725");
  const monthlyBudget = page.locator(".budget-month-section");
  await expect(monthlyBudget).toContainText("Spent from category limits");
  await expect(monthlyBudget).not.toContainText("Budget spending");

  await openPrimaryView(page, "Transactions");
  const form = page.locator(".transaction-form");
  await form.getByRole("button", { name: "Enter manually" }).click();
  await form.getByLabel("Description").fill("Health expense");
  await form.getByLabel("Amount").fill("125");
  await form.getByRole("button", { name: /Save transaction/ }).click();

  await openPrimaryView(page, "Overview");
  const budgetCard = page.locator(".overview-budget-card");
  await expect(budgetCard).toContainText("Monthly category limits");
  await expect(budgetCard).toContainText("Spent from category limits");
  await expect(budgetCard).toContainText("$125.00 is tracked without a limit");
  await expect(budgetCard).toContainText("This balance only includes expenses in categories with a monthly limit");
  await expect(budgetCard).toContainText("Other expenses still reduce your net worth");
  await expect(budgetCard).not.toContainText("scheduled payments are reserved separately");
  await expect(budgetCard).not.toContainText("Budget spending");
  await expect(budgetCard).not.toContainText("Outside category budgets");
});

test("empty planning screens show the next action and preview future insights", async ({ page }) => {
  await openPrimaryView(page, "Budget");
  await expect(page.locator(".category-budget-empty")).toContainText("Add your first category budget");
  await expect(page.locator(".category-heading-actions")).toHaveCount(0);
  await expect(page.locator(".budget-donut-panel")).toHaveCount(0);

  await openPrimaryView(page, "Insights");
  const emptyState = page.locator(".insights-empty-state");
  await expect(emptyState).toContainText("Add a transaction to unlock spending insights");
  await expect(emptyState.getByRole("button", { name: "Add first transaction" })).toBeVisible();
  const preview = page.locator(".insights-preview");
  await expect(preview).toContainText("Spending trend");
  await expect(preview).toContainText("Top category");
  await expect(preview).toContainText("Budget alerts");
  await expect(preview).toContainText("These fill in after your first expense");
  await expect(page.locator(".trend-card, .insight-kpis, .over-limit-panel")).toHaveCount(0);
});

test("new transactions offer one entry method at a time", async ({ page }) => {
  await openPrimaryView(page, "Transactions");
  const form = page.locator(".transaction-form");
  const method = form.getByRole("group", { name: "Entry method" });

  await expect(method.getByRole("button", { name: "Describe with AI" })).toHaveAttribute("aria-pressed", "true");
  await expect(form.getByLabel("Describe this transaction")).toBeVisible();
  await expect(form.getByLabel("Description", { exact: true })).toBeHidden();

  await method.getByRole("button", { name: "Enter manually" }).click();
  await expect(method.getByRole("button", { name: "Enter manually" })).toHaveAttribute("aria-pressed", "true");
  await expect(form.getByLabel("Describe this transaction")).toBeHidden();
  await expect(form.getByLabel("Description", { exact: true })).toBeVisible();
  await form.getByLabel("Count toward monthly budget").uncheck();
  await expect(form).toContainText("No · does not reduce category limits");
  await expect(form).not.toContainText("outside category budgets");

  await expect(page.locator(".transaction-list").getByRole("button", { name: "Select" })).toHaveCount(0);
  await expect(page.locator(".transaction-list").getByRole("button", { name: /View all/ })).toHaveCount(0);
  await expect(page.locator(".compact-summary")).toHaveCount(0);
});

test("settings explains autosave and the impact of changing the primary currency", async ({ page }) => {
  await openPrimaryView(page, "Settings");
  await expect(page.locator(".settings-save-note")).toContainText("Changes save automatically");
  await expect(page.locator(".currency-setting")).toContainText("Assets and transactions keep their original currency");
});

test("mobile workspaces keep full page names and readable supporting text", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "mobile-only readability contract");

  await openPrimaryView(page, "Transactions");
  const currentPage = page.locator(".mobile-current-page");
  await expect(currentPage).toHaveText("Transactions");
  expect(await currentPage.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

  for (const selector of [
    ".transaction-ai-heading p",
    ".transaction-ai-actions > small",
  ]) {
    const size = await page.locator(selector).first().evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
    expect(size, selector).toBeGreaterThanOrEqual(12);
  }
  await expectNoHorizontalOverflow(page);
});
