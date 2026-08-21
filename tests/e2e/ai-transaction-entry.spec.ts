import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, openApp, openPrimaryView } from "./helpers";

const completeDraft = {
  draft: {
    date: "2026-08-19",
    type: "expense",
    category: "Food",
    description: "Target groceries",
    amount: 42.18,
    currency: "USD",
    countsTowardMonthlyBudget: true,
    allocations: [],
  },
  needsReview: [],
  allocationNeedsReview: [],
};

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await openPrimaryView(page, "Transactions");
});

test("turns a natural-language purchase into a reviewable draft before saving", async ({ page }) => {
  let requestAuthorized = false;
  await page.route("**/api/transactions/parse", async (route) => {
    requestAuthorized = route.request().headers().authorization === "Bearer e2e-access-token";
    const body = route.request().postDataBuffer()?.toString("utf8") || "";
    expect(body).toContain("Yesterday I bought groceries at Target for $42.18");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(completeDraft) });
  });

  const form = page.locator(".transaction-form");
  await expect(form).toContainText("OpenAI");
  await form.getByLabel("Describe this transaction").fill("Yesterday I bought groceries at Target for $42.18");
  await form.getByRole("button", { name: "Create AI draft" }).click();

  await expect(form.getByRole("status")).toContainText("AI draft ready");
  await expect(form.getByLabel("Date")).toHaveValue("2026-08-19");
  await expect(form.getByLabel("Category")).toHaveValue("Food");
  await expect(form.getByLabel("Description")).toHaveValue("Target groceries");
  await expect(form.getByLabel("Amount")).toHaveValue("42.18");
  await expect(page.locator(".transaction-list")).not.toContainText("Target groceries");
  expect(requestAuthorized).toBe(true);

  await form.getByRole("button", { name: "Save transaction" }).click();
  await expect(page.locator(".transaction-list")).toContainText("Target groceries");
});

test("sends a selected card screenshot for AI analysis and keeps it attached to the draft", async ({ page }) => {
  let sentScreenshot = false;
  await page.route("**/api/transactions/parse", async (route) => {
    const body = route.request().postDataBuffer()?.toString("latin1") || "";
    sentScreenshot = body.includes("card-payment.png");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      ...completeDraft,
      draft: { ...completeDraft.draft, description: "Whole Foods Market", amount: 63.27 },
    }) });
  });

  const form = page.locator(".transaction-form");
  await form.locator('input[type="file"][accept="image/*"]').setInputFiles({
    name: "card-payment.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
  });
  await form.getByRole("button", { name: "Create AI draft" }).click();

  await expect(form.getByRole("status")).toContainText("AI draft ready");
  await expect(form.getByLabel("Description")).toHaveValue("Whole Foods Market");
  await expect(form.getByLabel("Amount")).toHaveValue("63.27");
  await expect(form.getByText("card-payment.png")).toBeVisible();
  expect(sentScreenshot).toBe(true);
});

test("keeps one mixed receipt transaction while reviewing item-level category allocations", async ({ page }) => {
  await page.route("**/api/transactions/parse", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      draft: {
        ...completeDraft.draft,
        description: "Target",
        amount: 30,
        allocations: [
          { description: "Milk", category: "Food", amount: 5 },
          { description: "Storage bin", category: "Shopping", amount: 25 },
        ],
      },
      needsReview: [],
      allocationNeedsReview: [[], []],
    }) });
  });

  const form = page.locator(".transaction-form");
  await form.locator('input[type="file"][accept="image/*"]').setInputFiles({
    name: "mixed-receipt.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
  });
  await form.getByRole("button", { name: "Create AI draft" }).click();

  const split = form.getByRole("group", { name: "Receipt category split" });
  await expect(split).toContainText("2 items across 2 categories");
  await expect(split.getByLabel("Receipt item 1 description")).toHaveValue("Milk");
  await expect(split.getByLabel("Receipt item 1 category")).toHaveValue("Food");
  await expect(split.getByLabel("Receipt item 2 description")).toHaveValue("Storage bin");
  await expect(split.getByLabel("Receipt item 2 category")).toHaveValue("Shopping");
  await expect(split).toContainText("Split total $30.00 matches receipt total $30.00");

  await form.getByRole("button", { name: "Save transaction" }).click();
  const row = page.locator(".transaction-list .transaction-row").filter({ hasText: "Target" });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Food · Shopping");
  await page.getByRole("button", { name: /View all/ }).click();
  await expect(page.locator(".transaction-category-bars")).toContainText("Food");
  await expect(page.locator(".transaction-category-bars")).toContainText("Shopping");
});

test("blocks saving an itemized receipt until its split matches the receipt total", async ({ page }) => {
  await page.route("**/api/transactions/parse", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      draft: {
        ...completeDraft.draft,
        description: "Target",
        amount: 30,
        allocations: [
          { description: "Milk", category: "Food", amount: 5 },
          { description: "Storage bin", category: "Shopping", amount: 20 },
        ],
      },
      needsReview: ["allocations"],
      allocationNeedsReview: [[], []],
    }),
  }));

  const form = page.locator(".transaction-form");
  await form.getByLabel("Describe this transaction").fill("Itemized Target receipt");
  await form.getByRole("button", { name: "Create AI draft" }).click();

  const split = form.getByRole("group", { name: "Receipt category split" });
  await expect(split).toContainText("$5.00 unassigned");
  await expect(form.getByRole("button", { name: "Save transaction" })).toBeDisabled();
  await split.getByLabel("Receipt item 2 amount").fill("25");
  await expect(split).toContainText("Split total $30.00 matches receipt total $30.00");
  await expect(form.getByRole("button", { name: "Save transaction" })).toBeEnabled();
});

test("requires an explicit fallback when AI cannot recover receipt items", async ({ page }) => {
  await page.route("**/api/transactions/parse", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      draft: { ...completeDraft.draft, description: "Faded receipt", amount: 30 },
      needsReview: ["allocations"],
      allocationNeedsReview: [],
    }),
  }));

  const form = page.locator(".transaction-form");
  await form.getByLabel("Describe this transaction").fill("A faded receipt with unreadable items");
  await form.getByRole("button", { name: "Create AI draft" }).click();

  await expect(form.getByRole("region", { name: "Receipt items need review" })).toBeVisible();
  await expect(form.getByRole("button", { name: "Save transaction" })).toBeDisabled();
  await form.getByRole("button", { name: "Use one category" }).click();
  await expect(form.getByRole("button", { name: "Save transaction" })).toBeEnabled();
});

test("keeps incomplete AI output out of the ledger and names the fields to review", async ({ page }) => {
  await page.route("**/api/transactions/parse", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      draft: { ...completeDraft.draft, amount: null },
      needsReview: ["amount"],
    }),
  }));

  const form = page.locator(".transaction-form");
  await form.getByLabel("Describe this transaction").fill("I bought something at Target");
  await form.getByRole("button", { name: "Create AI draft" }).click();

  await expect(form.getByRole("status")).toContainText("Check: amount");
  await expect(form.getByLabel("Amount")).toHaveValue("");
  await expect(form.getByRole("button", { name: "Save transaction" })).toBeDisabled();
  await expect(page.locator(".transaction-list")).not.toContainText("Target groceries");
});

test("shows a retryable error without changing manually entered transaction fields", async ({ page }) => {
  await page.route("**/api/transactions/parse", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ error: "AI analysis is temporarily unavailable. Try again." }),
  }));

  const form = page.locator(".transaction-form");
  await form.getByRole("button", { name: "Enter manually" }).click();
  await form.getByLabel("Description").fill("Keep this draft");
  await form.getByLabel("Amount").fill("19.50");
  await form.getByRole("button", { name: "Describe with AI" }).click();
  await form.getByLabel("Describe this transaction").fill("Coffee shop purchase");
  await form.getByRole("button", { name: "Create AI draft" }).click();

  await expect(form.getByRole("alert")).toContainText("temporarily unavailable");
  await form.getByRole("button", { name: "Enter manually" }).click();
  await expect(form.getByLabel("Description")).toHaveValue("Keep this draft");
  await expect(form.getByLabel("Amount")).toHaveValue("19.5");
});

test("keeps the AI assistant usable without horizontal overflow at its layout breakpoint", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "The mobile project already covers the small viewport.");
  await page.setViewportSize({ width: 901, height: 900 });
  await expect(page.getByRole("heading", { name: "Add a transaction" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create AI draft" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("keeps the final review and save action full width on mobile", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "This contract targets the mobile transaction form.");
  const form = page.locator(".transaction-form");
  await form.getByRole("button", { name: "Enter manually" }).click();
  const actionsBox = await form.locator(".transaction-form-actions").boundingBox();
  const saveBox = await form.getByRole("button", { name: "Save transaction" }).boundingBox();
  expect(actionsBox).not.toBeNull();
  expect(saveBox).not.toBeNull();
  expect(saveBox!.width).toBeGreaterThan(actionsBox!.width * 0.95);
  await expectNoHorizontalOverflow(page);
});
