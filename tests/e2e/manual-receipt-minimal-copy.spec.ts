import { expect, test } from "@playwright/test";
import { openApp, openPrimaryView } from "./helpers";

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test("attaches a receipt while entering an expense manually", async ({ page }) => {
  await openPrimaryView(page, "Transactions");
  const form = page.locator(".transaction-form");

  await form.getByRole("button", { name: "Enter manually" }).click();
  const receipt = form.getByLabel("Receipt · optional");
  await expect(receipt).toBeVisible();
  await receipt.setInputFiles({
    name: "manual-receipt.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
  });
  await expect(form.getByText("manual-receipt.png")).toBeVisible();

  await form.getByLabel("Description").fill("Manual groceries");
  await form.getByLabel("Amount").fill("24.50");
  await form.getByRole("button", { name: "Save transaction" }).click();

  const row = page.locator(".transaction-list .transaction-row").filter({ hasText: "Manual groceries" });
  await expect(row).toContainText("Receipt");
});

test("keeps primary workspaces and transaction choices concise", async ({ page }) => {
  await expect(page.locator(".overview-title p")).toHaveCount(0);
  await expect(page.locator(".overview-title > div > span")).toHaveCount(0);

  await openPrimaryView(page, "Transactions");
  const form = page.locator(".transaction-form");
  await expect(page.locator(".page-title p")).toHaveCount(0);
  await expect(page.locator(".page-title > div > span")).toHaveCount(0);
  await expect(form.locator(".transaction-entry-method small")).toHaveCount(0);
  await expect(form.locator(".transaction-ai-heading p")).toHaveCount(0);
  await expect(form.locator(".transaction-ai-actions > small")).toHaveText("Sent to OpenAI. Review before saving.");

  for (const workspace of ["Budget", "What-if", "Settings"]) {
    await openPrimaryView(page, workspace);
    await expect(page.locator(".page-title p")).toHaveCount(0);
    await expect(page.locator(".page-title > div > span")).toHaveCount(0);
  }

  await openPrimaryView(page, "Insights");
  await expect(page.locator(".insights-empty-copy p")).toHaveCount(0);
});
