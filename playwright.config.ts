import { defineConfig, devices } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'

/** Le back-office est une application distincte, sur son propre serveur. */
const ADMIN_URL = process.env.PLAYWRIGHT_ADMIN_URL ?? 'http://localhost:3001'

/**
 * Numéro autorisé pour le back-office pendant les tests.
 *
 * Préfixe `05` à dessein : `numeroDeTest()` ne fabrique que des `07`, donc
 * aucun compte de test ne peut tomber par hasard sur un numéro administrateur.
 */
const ADMIN_PHONE = '+2250500000001'

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
      testIgnore: /admin\//,
      use: { ...devices['Pixel 5'], viewport: { width: 360, height: 800 } },
    },
    {
      name: 'desktop-1280',
      testIgnore: /admin\//,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      // Amorce le compte d'administration et ouvre une session, une fois.
      name: 'admin-setup',
      testMatch: /admin\/.*\.setup\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: ADMIN_URL },
    },
    {
      // Le back-office est **desktop-first** (cahier des charges §555) : on
      // examine une pièce d'identité sur un écran large, pas sur un téléphone.
      // Il n'est donc pas rejoué à 360 px, contrairement à l'app membre.
      name: 'admin',
      testMatch: /admin\//,
      testIgnore: /\.setup\.ts/,
      dependencies: ['admin-setup'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        baseURL: ADMIN_URL,
        // La session est ouverte une seule fois : les demandes de code sont
        // plafonnées par numéro, et cette garde ne doit pas être désactivée
        // pour la commodité des tests.
        storageState: 'tests/e2e/admin/.session-admin.json',
      },
    },
  ],

  // Deux serveurs : l'application des membres et le back-office. Ils partagent
  // la base de données, comme en production, mais rien d'autre.
  webServer: [
    {
      command: 'pnpm dev',
      // Coupe le panneau flottant des DevTools, qui intercepte les clics à 360 px.
      env: { PLAYWRIGHT: '1' },
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'pnpm dev:admin',
      env: { PLAYWRIGHT: '1', NUXT_ADMIN_PHONES: ADMIN_PHONE },
      url: ADMIN_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
})
