/**
 * global-setup.spec.js
 *
 * Runs once before all E2E tests (via the `e2e-setup` project).
 * Logs in as admin and saves the browser storage state so subsequent
 * E2E tests start already authenticated.
 *
 * Run: npx playwright test --project=e2e-setup
 * Or: npx playwright test   (runs all projects in order)
 */
import { test } from '@playwright/test';
import { mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTH_DIR  = join(__dirname, '.auth');
const AUTH_FILE = join(AUTH_DIR, 'user.json');

test('save auth state', async ({ page, context }) => {
  await mkdir(AUTH_DIR, { recursive: true });

  await page.goto('/login');
  await page.fill('input[name="email"]',    'admin@procurement.com');
  await page.fill('input[name="password"]', 'Admin123!');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard', { timeout: 15_000 });

  await context.storageState({ path: AUTH_FILE });
});
