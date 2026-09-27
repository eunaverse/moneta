import { expect, test } from '@playwright/test';
import { openApp, openPrimaryView, expectNoHorizontalOverflow } from './helpers';

test('insight amounts stay readable within each month at short and long ranges', async ({ page }, testInfo) => {
  await openApp(page);
  await openPrimaryView(page, 'Transactions');
  const form = page.locator('.transaction-form');
  await form.getByRole('button', { name: 'Enter manually' }).click();
  await form.getByLabel('Description').fill('Large expense');
  await form.getByLabel('Amount', { exact: true }).fill('1234567.89');
  await form.getByRole('button', { name: 'Save transaction' }).click();
  await openPrimaryView(page, 'Insights');
  for (const months of [3, 12, 24]) {
    await page.locator('.insight-range-controls').getByRole('spinbutton').fill(String(months));
    await expect(page.locator('.trend-bar-values')).toHaveCount(months);
    for (const label of await page.locator('.trend-bars > div > b').allTextContents()) {
      expect(label).toMatch(/^\d{4}-\d{2}$/);
    }
    const measurements = await page.locator('.trend-bar-values small').evaluateAll(elements => elements.map(el => {
      const box = el.getBoundingClientRect();
      const column = el.closest('.trend-bars > div')!.getBoundingClientRect();
      return { fits: box.left >= column.left - 1 && box.right <= column.right + 1 && el.scrollWidth <= el.clientWidth + 1, size: parseFloat(getComputedStyle(el).fontSize) };
    }));
    expect(measurements.every(item => item.fits && item.size >= 12)).toBe(true);
    await expectNoHorizontalOverflow(page);
  }
  const scroller = page.locator('.trend-scroll');
  await scroller.scrollIntoViewIfNeeded();
  await scroller.evaluate(el => { el.scrollLeft = el.scrollWidth; });
  await expect(page.locator('.trend-bar-values').last()).toContainText('$1,234,567.89 flexible');
  await expect(page.locator('.trend-bar-values').last()).toBeInViewport();
  await page.locator('.trend-card').screenshot({ path: testInfo.outputPath('spending-trend.png') });
});
