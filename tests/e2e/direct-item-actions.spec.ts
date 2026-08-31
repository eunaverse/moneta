import { expect, test, type Page } from "@playwright/test";
import { openApp, openPrimaryView } from "./helpers";

async function saveShoppingExpense(page: Page, description: string, countsTowardMonthlyBudget = true) {
  const form = page.locator(".transaction-form");
  await form.getByRole("button", { name: "Enter manually" }).click();
  await form.getByLabel("Category").selectOption("Shopping");
  await form.getByLabel("Description").fill(description);
  await form.getByLabel("Amount").fill("42.18");
  if (!countsTowardMonthlyBudget) await form.getByLabel("Count toward monthly budget").uncheck();
  await form.getByRole("button", { name: /Save transaction/ }).click();
  await expect(page.getByText(description, { exact: true })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await openPrimaryView(page, "Transactions");
});

test("adds a newly spent category to Budget without inventing a monthly limit", async ({ page }, testInfo) => {
  await saveShoppingExpense(page, "Weekend groceries");
  await expect(page.getByText("Transaction added. Shopping added to Budget.")).toBeVisible();

  await openPrimaryView(page, "Budget");
  const row = page.locator(".budget-category-row").filter({ hasText: "Shopping" });
  await expect(row).toBeVisible();
  await expect(row).toContainText("$42.18 spent");
  await expect(row).toContainText("SET LIMIT");
  await expect(row.getByLabel("Shopping expected monthly budget")).toHaveValue("");
  await expect(page.getByLabel("Category to add to budgets").getByRole("option", { name: "Shopping" })).toHaveCount(0);
  if (testInfo.project.name.includes("mobile")) {
    const [copyBox, balanceBox, inputBox, moreBox] = await Promise.all([
      row.locator(".budget-category-copy").boundingBox(),
      row.locator(".budget-category-balance").boundingBox(),
      row.locator(".budget-amount-input").boundingBox(),
      row.getByRole("button", { name: "More actions for Shopping" }).boundingBox(),
    ]);
    expect(copyBox?.x).toBeLessThan(balanceBox?.x ?? 0);
    expect(inputBox?.x).toBeLessThan(moreBox?.x ?? 0);
    expect(moreBox?.width).toBeGreaterThanOrEqual(44);
    expect(moreBox?.height).toBeGreaterThanOrEqual(44);
  }
});

test("keeps an explicitly outside-budget expense outside Budget", async ({ page }) => {
  await saveShoppingExpense(page, "Vacation treat", false);
  await openPrimaryView(page, "Budget");

  await expect(page.locator(".budget-category-row").filter({ hasText: "Shopping" })).toHaveCount(0);
});

test("right-click deletes one transaction directly and keeps Undo", async ({ page }) => {
  await saveShoppingExpense(page, "Context groceries");

  await page.getByRole("button", { name: "View details for Context groceries" }).click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Actions for Context groceries" });
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "Delete transaction" }).click();

  await expect(page.getByText("Context groceries", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Transaction deleted.")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Context groceries", { exact: true })).toBeVisible();
});

test("long-press opens the same item menu on touch screens", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "touch-only interaction contract");
  await saveShoppingExpense(page, "Held groceries");

  const row = page.getByRole("button", { name: "View details for Held groceries" });
  const box = await row.boundingBox();
  expect(box).not.toBeNull();
  const point = { clientX: box!.x + 20, clientY: box!.y + 20, pointerType: "touch", button: 0 };
  await row.dispatchEvent("pointerdown", point);
  await page.waitForTimeout(650);
  await row.dispatchEvent("pointerup", point);

  await expect(page.getByRole("menu", { name: "Actions for Held groceries" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Held groceries" })).toHaveCount(0);
});

test("a budget row has the same direct removal menu and Undo", async ({ page }) => {
  await saveShoppingExpense(page, "Budget groceries");
  await openPrimaryView(page, "Budget");

  const row = page.locator(".budget-category-row").filter({ hasText: "Shopping" });
  await row.getByRole("button", { name: "More actions for Shopping" }).click();
  await page.getByRole("menu", { name: "Actions for Shopping" }).getByRole("menuitem", { name: "Delete budget" }).click();
  await expect(row).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".budget-category-row").filter({ hasText: "Shopping" })).toBeVisible();
});

test("a scheduled payment can be removed from its row and restored", async ({ page }) => {
  await openPrimaryView(page, "Budget");
  await page.getByRole("button", { name: "Scheduled payments", exact: true }).click();
  const form = page.locator(".recurring-form");
  await form.getByLabel("Name").fill("Gym membership");
  await form.getByLabel("Amount").fill("80");
  await form.getByRole("button", { name: /Add monthly payment/ }).click();

  const row = page.locator(".recurring-row").filter({ hasText: "Gym membership" });
  await row.click({ button: "right" });
  await page.getByRole("menu", { name: "Actions for Gym membership" }).getByRole("menuitem", { name: "Delete scheduled payment" }).click();
  await expect(row).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".recurring-row").filter({ hasText: "Gym membership" })).toBeVisible();
});

test("a category row keeps confirmation and Undo for record-moving deletion", async ({ page }) => {
  await openPrimaryView(page, "Settings");
  await page.getByRole("button", { name: /Manage/ }).click();
  const row = page.locator(".category-manager-row").filter({ has: page.getByLabel("Rename Shopping") });
  await row.click({ button: "right" });
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("menu", { name: "Actions for Shopping" }).getByRole("menuitem", { name: "Delete category" }).click();
  await expect(page.getByLabel("Rename Shopping")).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByLabel("Rename Shopping")).toBeVisible();
});
