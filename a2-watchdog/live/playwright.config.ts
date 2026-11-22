import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  workers: 4,
  retries: 0,
  reporter: [['json', { outputFile: '../results/live-report.json' }]],
  use: {
    headless: true,
    // Reuse a locally installed headless shell if the exact revision is not downloaded.
    ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
  },
});
