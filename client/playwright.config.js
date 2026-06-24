import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const API_URL   = process.env.API_URL  || 'http://127.0.0.1:5000';
const APP_URL   = process.env.APP_URL  || 'http://127.0.0.1:3000';
const AUTH_FILE = join(__dirname, 'tests/e2e/.auth/user.json');

export default defineConfig({
  testTimeout: 30_000,
  expect: { timeout: 8_000 },
  retries: 0,
  reporter: process.env.CI ? 'github' : [['html', { open: 'never' }], ['line']],
  fullyParallel: false,
  workers: 1, // Force séquentiel pour partager l'état entre tests du flow

  projects: [
    // ── Tests d'intégration API (pas de browser, cible le backend) ─────────
    {
      name: 'api',
      testMatch: 'tests/api/**/*.spec.js',
      use: {
        baseURL: API_URL,
      },
    },

    // ── Setup E2E : login une fois, sauvegarde l'état navigateur ───────────
    //    Lancer en premier avec : npm run test:setup
    {
      name: 'e2e-setup',
      testMatch: 'tests/e2e/global-setup.spec.js',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: APP_URL,
      },
    },

    // ── Tests E2E browser (réutilise l'état sauvegardé) ────────────────────
    //    Dépend de e2e-setup. Lance avec : npm run test:e2e
    {
      name: 'e2e',
      testMatch: 'tests/e2e/**/*.spec.js',
      testIgnore: ['tests/e2e/global-setup.spec.js'],
      dependencies: ['e2e-setup'],
      use: {
        ...devices['Desktop Chrome'],
        baseURL: APP_URL,
        // Charge l'état de session si disponible (créé par e2e-setup)
        storageState: existsSync(AUTH_FILE) ? AUTH_FILE : undefined,
      },
    },
  ],
});
