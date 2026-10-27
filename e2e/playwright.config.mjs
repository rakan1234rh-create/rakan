import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Smoke-only config. Serves the local mock harness — does not hit production,
 * Supabase, or Cloudflare. Safe to run without app secrets.
 */
export default defineConfig({
  testDir: path.join(__dirname, 'tests'),
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: 'http://127.0.0.1:4177',
    trace: 'on-first-retry',
    locale: 'ar-SA',
  },
  webServer: {
    command: 'npx --yes serve fixtures -l 4177 --no-port-switching',
    cwd: __dirname,
    url: 'http://127.0.0.1:4177/smoke-harness.html',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
