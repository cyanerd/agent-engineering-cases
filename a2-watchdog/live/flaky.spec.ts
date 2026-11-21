import { expect, test } from '@playwright/test';

const APP = new URL('./app.html', import.meta.url).href;

// Typical flaky test #1: the wait is shorter than the tail of the backend latency.
test('orders load', async ({ page }) => {
  await page.goto(APP);
  await page.click('#load');
  // Timeouts differ between suites and environments; the message differs with them.
  await expect(page.locator('#status')).toHaveText(/Готово/, { timeout: 800 + Math.floor(Math.random() * 4) * 100 });
});

// Typical flaky test #2: reads the list once instead of waiting for it (race between test and UI).
test('three orders shown', async ({ page }) => {
  await page.goto(APP);
  await page.click('#load');
  await page.waitForTimeout(500);
  expect(await page.locator('#orders li').count()).toBe(3);
});
