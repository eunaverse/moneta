import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, openApp, openPrimaryView } from "./helpers";

test("select controls use one aligned touch-friendly layout", async ({ page }) => {
  await openApp(page);
  await openPrimaryView(page, "Transactions");
  await page.locator(".transaction-form").getByRole("button", { name: "Enter manually" }).click();
  const transactionSelects = page.locator(".workspace select:visible");
  expect(await transactionSelects.count()).toBeGreaterThan(0);

  for (let index = 0; index < await transactionSelects.count(); index += 1) {
    const styles = await transactionSelects.nth(index).evaluate((select) => {
      const computed = getComputedStyle(select);
      return {
        appearance: computed.appearance,
        backgroundImage: computed.backgroundImage,
        height: select.getBoundingClientRect().height,
        paddingRight: Number.parseFloat(computed.paddingRight),
      };
    });
    expect(styles.appearance).toBe("none");
    expect(styles.backgroundImage).not.toBe("none");
    expect(styles.height).toBeGreaterThanOrEqual(44);
    expect(styles.paddingRight).toBeGreaterThanOrEqual(36);
  }

  await expectNoHorizontalOverflow(page);
});
