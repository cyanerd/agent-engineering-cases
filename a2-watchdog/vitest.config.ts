import { defineConfig } from 'vitest/config';

// live/ holds Playwright specs (run with `pnpm live`), not vitest tests.
export default defineConfig({ test: { exclude: ['live/**', 'node_modules/**'] } });
