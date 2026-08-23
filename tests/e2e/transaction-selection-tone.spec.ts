import { expect, test } from "@playwright/test";
import { openApp, openPrimaryView } from "./helpers";

test.beforeEach(async ({ page }) => openApp(page));

test("ordinary transaction type selection uses the primary action color", async ({ page }) => {
  await openPrimaryView(page, "Transactions");
  const form = page.locator(".transaction-form");
  await form.getByRole("button", { name: "Enter manually" }).click();

  const expense = form.getByRole("button", { name: "Expense", exact: true });
  const income = form.getByRole("button", { name: "Income", exact: true });
  await expect(expense).toHaveClass(/active/);
  await expect(expense).toHaveCSS("background-color", "rgb(112, 87, 232)");

  await income.click();
  await expect(income).toHaveClass(/active/);
  await expect(income).toHaveCSS("background-color", "rgb(112, 87, 232)");
});
