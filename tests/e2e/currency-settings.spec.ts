import { expect, test } from "@playwright/test";
import { migrateLegacyAssetRecord } from "../../lib/moneta-state";
import { expectNoHorizontalOverflow, openApp, openPrimaryView } from "./helpers";

test.beforeEach(async ({ page }) => openApp(page));

test("new accounts use USD and no sample category budgets or import control", async ({ page }) => {
  await openPrimaryView(page, "Budget");
  await expect(page.locator(".category-budget-empty")).toContainText("Add your first category budget");
  await expect(page.getByLabel("Housing expected monthly budget")).toHaveCount(0);

  await openPrimaryView(page, "Settings");
  await expect(page.getByLabel("Primary display currency")).toHaveValue("USD");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download backup" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^moneta-backup-\d{4}-\d{2}-\d{2}\.json$/);
  await expect(page.getByText(/Import/i)).toHaveCount(0);
  await expect(page.locator('input[type="file"][accept*="json"]')).toHaveCount(0);
});

test("migrates saved legacy balances to the current asset format once", async () => {
  let persistedState;
  const result = await migrateLegacyAssetRecord({
    state: {
      version: 2,
      data: {
        krwPrimary: 1_400_000,
        usdCash: 500,
        exchangeRate: 1_400,
        planningStartMonth: "2026-08",
        planningEndMonth: "2028-07",
        monthlyIncome: 0,
      },
      entries: [{
        id: "saved-expense",
        date: "2026-08-20",
        type: "expense",
        category: "Food",
        description: "Groceries",
        amount: 70,
        currency: "USD",
      }],
      monthlyBudgets: { Food: 650 },
      expenseCategories: ["Food", "Other"],
      budgetCategories: ["Food"],
    },
    updatedAt: "2026-08-24T12:00:00.000Z",
  }, async (state) => {
    persistedState = state;
    return { state, updatedAt: "2026-08-24T12:01:00.000Z" };
  });

  expect(result.migrated).toBe(true);
  expect(persistedState?.data.assets).toEqual([
    { id: "legacy-primary-krw", name: "Primary account", amount: 1_400_000, currency: "KRW" },
    { id: "legacy-usd-cash", name: "Cash", amount: 500, currency: "USD" },
  ]);
  expect(persistedState?.entries).toHaveLength(1);
  expect(persistedState?.monthlyBudgets).toEqual({ Food: 650 });
});

test("restores only device-backed assets when the saved remote asset list is empty", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __MONETA_E2E_REMOTE_STATE__: unknown }).__MONETA_E2E_REMOTE_STATE__ = {
      version: 2,
      data: {
        assets: [],
        displayCurrency: "USD",
        exchangeRates: {},
        planningStartMonth: "2026-08",
        planningEndMonth: "2028-07",
        monthlyIncome: 4_000,
      },
      entries: [{
        id: "remote-expense",
        date: "2026-08-20",
        type: "expense",
        category: "Food",
        description: "Remote groceries",
        amount: 70,
        currency: "USD",
        countsTowardMonthlyBudget: true,
      }],
      monthlyBudgets: { Food: 650 },
      expenseCategories: ["Food", "Other"],
      budgetCategories: ["Food"],
      categorySort: "manual",
      recurringExpenses: [],
      insightMonths: 6,
    };
    localStorage.setItem("move-money-budget", JSON.stringify({
      krwPrimary: 1_400_000,
      krwSecondary: 0,
      krwEmergency: 0,
      usdCash: 500,
      exchangeRate: 1_400,
      planningStartMonth: "2026-08",
      planningEndMonth: "2028-07",
      monthlyIncome: 0,
    }));
  });
  await page.goto("/");

  const recovery = page.getByRole("region", { name: "Device asset backup found" });
  await expect(recovery).toBeVisible();
  await recovery.getByRole("button", { name: "Restore balances" }).click();

  await expect(recovery).toHaveCount(0);
  await page.getByText("Accounts & calculation").click();
  await expect(page.getByText("Primary account", { exact: true })).toBeVisible();
  await expect(page.getByText("Cash", { exact: true })).toBeVisible();

  await openPrimaryView(page, "Transactions");
  await expect(page.getByText("Remote groceries", { exact: true })).toBeVisible();
  await openPrimaryView(page, "Budget");
  await expect(page.getByLabel("Food expected monthly budget")).toHaveValue("650");
});

test("converts a foreign asset with a user-entered exchange rate", async ({ page }) => {
  await page.getByRole("button", { name: "Edit assets" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit assets & rates" });
  await dialog.getByRole("button", { name: "Add asset" }).click();
  await dialog.getByLabel("Asset 1 name").fill("Korean savings");
  await dialog.getByLabel("Asset 1 amount").fill("1400000");
  await dialog.getByLabel("Asset 1 currency").selectOption("KRW");

  await expect(dialog.getByText("Add a positive exchange rate for KRW")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save balances" })).toBeDisabled();
  await dialog.getByLabel("KRW per USD").fill("1400");
  await expect(dialog.getByRole("button", { name: "Save balances" })).toBeEnabled();
  await dialog.getByRole("button", { name: "Save balances" }).click();

  await expect(page.locator(".wealth-overview-heading").getByText("$1,000", { exact: true })).toBeVisible();
  await page.getByText("Accounts & calculation").click();
  await expect(page.getByText("Korean savings", { exact: true })).toBeVisible();
  await expect(page.getByText(/1,400,000/)).toBeVisible();
});

test("uses configured foreign currencies for transactions and display totals", async ({ page }) => {
  await page.getByRole("button", { name: "Edit assets" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit assets & rates" });
  await dialog.getByRole("button", { name: "Add asset" }).click();
  await dialog.getByLabel("Asset 1 name").fill("KRW wallet");
  await dialog.getByLabel("Asset 1 currency").selectOption("KRW");
  await dialog.getByLabel("KRW per USD").fill("1400");
  await dialog.getByRole("button", { name: "Save balances" }).click();

  await openPrimaryView(page, "Transactions");
  const form = page.locator(".transaction-form");
  await form.getByRole("button", { name: "Enter manually" }).click();
  await form.getByLabel("Description").fill("Transit pass");
  await form.getByLabel("Amount").fill("140000");
  await form.getByLabel("Currency").selectOption("KRW");
  await form.getByRole("button", { name: /Save transaction/ }).click();

  await expect(page.getByText("Transit pass", { exact: true })).toBeVisible();
  await expect(page.locator(".transaction-summary").getByText("−$100", { exact: true }).first()).toBeVisible();
  await expect(page.locator(".transaction-row").filter({ hasText: "Transit pass" })).toContainText("140,000");
});

test("allows an empty account to choose another primary currency", async ({ page }) => {
  await openPrimaryView(page, "Settings");
  await page.getByLabel("Primary display currency").selectOption("EUR");
  await expect(page.getByText("€0 current net worth", { exact: true })).toBeVisible();
});

test("asset and rate controls remain usable at a medium viewport", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "one medium-viewport pass is sufficient");
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.getByRole("button", { name: "Edit assets" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit assets & rates" });
  await dialog.getByRole("button", { name: "Add asset" }).click();
  await dialog.getByLabel("Asset 1 currency").selectOption("JPY");
  await expect(dialog.getByLabel("JPY per USD")).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
