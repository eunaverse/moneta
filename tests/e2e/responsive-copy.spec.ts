import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, openApp, openPrimaryView } from "./helpers";

test.beforeEach(async ({ page }) => openApp(page));

test("concise supporting copy stays readable at supported widths", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "desktop context covers the supported responsive widths");

  await openPrimaryView(page, "Insights");
  const previewTitle = page.locator(".insights-preview-heading h2");

  for (const width of [390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1100 });
    await expect(previewTitle).toBeVisible();

    const typography = await previewTitle.evaluate((element) => {
      const style = getComputedStyle(element);
      const lineHeight = Number.parseFloat(style.lineHeight);
      return {
        lines: Math.round(element.getBoundingClientRect().height / lineHeight),
        textWrap: style.textWrap,
      };
    });

    expect(typography.lines, `${width}px Insights preview title`).toBe(1);
    expect(typography.textWrap, `${width}px Insights preview title`).toBe("balance");
    await expectNoHorizontalOverflow(page);
  }

  await openPrimaryView(page, "Settings");
  for (const selector of [".settings-grid p", ".preference-settings-grid p"]) {
    const copy = page.locator(selector).first();
    const typography = await copy.evaluate((element) => {
      const style = getComputedStyle(element);
      return { maxInlineSize: style.maxInlineSize, textWrap: style.textWrap };
    });
    expect(typography.textWrap, selector).toBe("pretty");
    expect(typography.maxInlineSize, selector).not.toBe("none");
  }
  await expectNoHorizontalOverflow(page);
});
