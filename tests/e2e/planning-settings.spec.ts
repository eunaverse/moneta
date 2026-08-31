import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { openApp, openPrimaryView } from "./helpers";

test.beforeEach(async ({ page }) => openApp(page));

test("new accounts choose both planning months before entering the workspace", async ({ page }) => {
  await page.goto("/?first-use=1");

  await expect(page.getByRole("heading", { level: 1, name: "Choose your planning dates" })).toBeVisible();
  const startMonth = page.getByLabel("Plan start month");
  const endMonth = page.getByLabel("Plan end month");
  await expect(startMonth).toHaveAttribute("type", "month");
  await expect(endMonth).toHaveAttribute("type", "month");
  await expect(startMonth).toHaveValue("");
  await expect(endMonth).toHaveValue("");
  await expect(endMonth).toBeDisabled();
  await expect(page.getByRole("button", { name: "Start my plan" })).toBeDisabled();

  await startMonth.fill("2030-04");
  await expect(endMonth).toBeEnabled();
  await expect(endMonth).toHaveAttribute("min", "2030-04");
  await endMonth.fill("2032-09");
  await page.getByRole("button", { name: "Start my plan" }).click();

  await expect(page.getByRole("heading", { level: 1, name: /Make your money last/ })).toBeVisible();
  await openPrimaryView(page, "Settings");
  await expect(page.getByLabel("Planning start month")).toHaveValue("2030-04");
  await expect(page.getByLabel("Planning end month")).toHaveValue("2032-09");
});

test("first sign-in copy does not expose the backend provider", async () => {
  const authGate = await readFile(new URL("../../components/moneta-auth-gate.tsx", import.meta.url), "utf8");

  expect(authGate).not.toContain("Google may show Supabase");
  expect(authGate).toContain("Sign in securely with Google");
});

test("settings currency picker fills its responsive row and uses one clear arrow", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await openPrimaryView(page, "Settings");

  const field = page.locator(".currency-setting > label");
  const select = page.getByLabel("Primary display currency");
  const [cardBox, fieldBox, selectBox] = await Promise.all([page.locator(".currency-setting").boundingBox(), field.boundingBox(), select.boundingBox()]);
  expect(cardBox).not.toBeNull();
  expect(fieldBox).not.toBeNull();
  expect(selectBox).not.toBeNull();
  expect((fieldBox?.width ?? 0) / (cardBox?.width ?? 1)).toBeGreaterThanOrEqual(0.85);
  expect((selectBox?.width ?? 0) / (fieldBox?.width ?? 1)).toBeGreaterThanOrEqual(0.9);

  const styles = await select.evaluate((element) => {
    const computed = getComputedStyle(element);
    return { appearance: computed.appearance, backgroundImage: computed.backgroundImage };
  });
  expect(styles.appearance).toBe("none");
  expect(styles.backgroundImage).not.toBe("none");
});

test("previews a what-if purchase and prepares a one-time payment", async ({ page }) => {
  await openPrimaryView(page, "What-if");
  await expect(page.getByText("PLAN END DATE", { exact: true })).toBeVisible();
  await expect(page.getByText("Simulation period", { exact: true })).toHaveCount(0);
  await page.getByLabel("One-time purchase").fill("500");
  await expect(page.locator(".scenario-result")).toBeVisible();
  await expect(page.getByLabel("What-if calculation breakdown")).toContainText("What-if one-time purchase");
  await expect(page.getByText(/ESTIMATED BALANCE AT PLAN END/)).toBeVisible();
  await page.getByRole("button", { name: /Prepare as one-time payment/ }).click();
  await expect(page.getByRole("heading", { name: "Scheduled payments", level: 1 })).toBeVisible();
  await expect(page.locator(".recurring-form").getByLabel("Name")).toHaveValue("What-if purchase");
});

test("edits assets, the fixed plan period, and insights period", async ({ page }) => {
  await page.getByRole("button", { name: "Edit assets" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit assets & rates" });
  await dialog.getByRole("button", { name: "Add asset" }).click();
  await dialog.getByLabel("Asset 1 name").fill("Checking");
  await dialog.getByLabel("Asset 1 amount").fill("10000");
  await dialog.getByRole("button", { name: "Save balances" }).click();
  await expect(page.getByText("$10,000", { exact: true }).first()).toBeVisible();

  await openPrimaryView(page, "Settings");
  await page.getByLabel("Planning end month").fill("2099-12");
  await expect(page.getByLabel("Planning end month")).toHaveValue("2099-12");
  await openPrimaryView(page, "Insights");
  const lookback = page.locator(".insight-range-controls").getByRole("spinbutton");
  await lookback.fill("12");
  await expect(lookback).toHaveValue("12");
  await expect(page.locator(".insights-empty-state")).toContainText("No spending yet");
});

test("creates and renames a category and exposes a download-only backup", async ({ page }) => {
  await openPrimaryView(page, "Settings");
  await page.getByRole("button", { name: /Manage/ }).click();
  await page.getByLabel("New category name").fill("Pets");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: /Load more/ }).click();
  const category = page.getByLabel("Rename Pets");
  await category.fill("Pet care");
  await category.press("Enter");
  await expect(page.getByLabel("Rename Pet care")).toBeVisible();

  await page.getByRole("button", { name: /Settings/ }).first().click();
  await expect(page.getByRole("button", { name: "Download backup" })).toBeVisible();
  await expect(page.locator('input[type="file"][accept*="json"]')).toHaveCount(0);
});
