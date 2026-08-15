import { expect, test } from "@playwright/test";
import { openApp, openPrimaryView } from "./helpers";

test("browser back and forward restore the previous Moneta workspace", async ({ page }) => {
  await openApp(page);
  await openPrimaryView(page, "Budget");
  await expect(page).toHaveURL(/\?view=budget$/);

  await openPrimaryView(page, "Insights");
  await expect(page).toHaveURL(/\?view=insights$/);

  await page.goBack();
  await expect(page.getByRole("heading", { name: "Budget", level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/\?view=budget$/);

  await page.goBack();
  await expect(page.getByRole("heading", { name: /Your money/, level: 1 })).toBeVisible();
  await expect(page).not.toHaveURL(/[?&]view=/);

  await page.goForward();
  await expect(page.getByRole("heading", { name: "Budget", level: 1 })).toBeVisible();
});
