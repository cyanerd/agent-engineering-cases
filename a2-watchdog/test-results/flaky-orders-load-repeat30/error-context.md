# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: flaky.spec.ts >> orders load
- Location: live/flaky.spec.ts:6:1

# Error details

```
Error: expect(locator).toHaveText(expected) failed

Locator: locator('#status')
Expected pattern: /Готово/
Received string:  "Загрузка…"
Timeout: 900ms

Call log:
  - Expect "toHaveText" locator('#status') with timeout 900ms
  - waiting for locator('#status')
    10 × locator resolved to <p id="status">Загрузка…</p>
       - unexpected value "Загрузка…"

```

```yaml
- paragraph: Загрузка…
```

# Test source

```ts
  1  | import { expect, test } from '@playwright/test';
  2  | 
  3  | const APP = new URL('./app.html', import.meta.url).href;
  4  | 
  5  | // Typical flaky test #1: the wait is shorter than the tail of the backend latency.
  6  | test('orders load', async ({ page }) => {
  7  |   await page.goto(APP);
  8  |   await page.click('#load');
> 9  |   await expect(page.locator('#status')).toHaveText(/Готово/, { timeout: 900 });
     |                                         ^ Error: expect(locator).toHaveText(expected) failed
  10 | });
  11 | 
  12 | // Typical flaky test #2: reads the list once instead of waiting for it (race between test and UI).
  13 | test('three orders shown', async ({ page }) => {
  14 |   await page.goto(APP);
  15 |   await page.click('#load');
  16 |   await page.waitForTimeout(500);
  17 |   expect(await page.locator('#orders li').count()).toBe(3);
  18 | });
  19 | 
```