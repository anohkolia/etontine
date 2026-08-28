import { defineConfig, devices } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  // Une reprise en local aussi : le serveur de développement compile les routes
  // à la demande, et deux profils qui tapent en parallèle sur une route encore
  // froide peuvent dépasser le délai de navigation. Ce n'est pas un défaut du
  // produit. En CI, l'environnement est figé et deux reprises suffisent.
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    // La première visite d'une route en développement déclenche sa compilation.
    navigationTimeout: 30_000,
    actionTimeout: 15_000,
  },

  // Les quatre parcours critiques doivent passer à 360 px comme à 1280 px
  // (T26). Les deux profils sont donc posés dès le socle.
  projects: [
    {
      name: 'mobile-360',
      use: { ...devices['Pixel 5'], viewport: { width: 360, height: 800 } },
    },
    {
      name: 'desktop-1280',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],

  webServer: {
    command: 'pnpm dev',
    // Coupe le panneau flottant des DevTools, qui intercepte les clics à 360 px.
    env: { PLAYWRIGHT: '1' },
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
