import { expect, test } from "@playwright/test";
import { openApp, openPrimaryView } from "./helpers";

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await openPrimaryView(page, "Transactions");
});

test("creates, edits, filters, deletes, and restores a transaction", async ({ page }) => {
  const form = page.locator(".transaction-form");
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
  await page.locator(".transaction-history-list").getByRole("button", { name: "Select" }).click();
  await page.getByRole("checkbox", { name: "Select Weekly groceries" }).check();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: /Delete transactions/ }).click();
  await expect(page.getByText("No matching transactions")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Weekly groceries", { exact: true })).toBeVisible();
});

test("rejects a non-image receipt", async ({ page }) => {
  await page.locator('input[type="file"][accept="image/*"]').setInputFiles({
    name: "receipt.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not an image"),
  });
  await expect(page.getByText("Choose an image file.")).toBeVisible();
});
