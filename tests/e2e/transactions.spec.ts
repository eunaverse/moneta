import { expect, test } from "@playwright/test";
import { openApp, openPrimaryView } from "./helpers";

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await openPrimaryView(page, "Transactions");
});

test("creates, edits, filters, deletes, and restores a transaction", async ({ page }) => {
  const form = page.locator(".transaction-form");
  await form.getByRole("button", { name: "Enter manually" }).click();
  await form.getByLabel("Description").fill("Groceries");
  await form.getByLabel("Amount").fill("125");
  await form.getByRole("button", { name: /Save transaction/ }).click();
  await expect(page.getByText("Groceries", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Edit Groceries" }).click();
  await form.getByLabel("Description").fill("Weekly groceries");
  await form.getByRole("button", { name: /Save changes/ }).click();
  await expect(page.getByText("Weekly groceries", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /View all/ }).click();
  await page.locator(".transaction-filter-bar").getByLabel("BUDGET").selectOption("outside");
  await expect(page.getByText("No matching transactions")).toBeVisible();
  await page.getByRole("button", { name: "Clear" }).click();
  await page.getByRole("button", { name: "View details for Weekly groceries" }).click({ button: "right" });
  await page.getByRole("menu", { name: "Actions for Weekly groceries" }).getByRole("menuitem", { name: "Delete transaction" }).click();
  await expect(page.getByText("No matching transactions")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Weekly groceries", { exact: true })).toBeVisible();
});

test("accepts cents while a transaction amount is typed sequentially", async ({ page }) => {
  const form = page.locator(".transaction-form");
  await form.getByRole("button", { name: "Enter manually" }).click();

  const amount = form.getByLabel("Amount");
  await amount.pressSequentially("24.5");

  await expect(amount).toHaveValue("24.5");
  await form.getByLabel("Description").fill("Decimal purchase");
  await form.getByRole("button", { name: "Save transaction" }).click();

  const row = page.locator(".transaction-list .transaction-row").filter({ hasText: "Decimal purchase" });
  await expect(row).toContainText("$24.50");
});

test("rejects a non-image receipt", async ({ page }) => {
  await page.locator('input[type="file"][accept="image/*"]').setInputFiles({
    name: "receipt.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not an image"),
  });
  await expect(page.getByText("Choose an image file.")).toBeVisible();
});
