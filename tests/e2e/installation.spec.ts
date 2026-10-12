import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { waitForHydration } from './helpers/hydration'
import { seConnecter } from './helpers/session'

/**
 * Installer l'application, sur n'importe quel terminal.
 *
 * Le serveur de développement ne sert ni le manifeste ni le service worker :
 * aucun navigateur n'y propose d'installer. L'invitation de Chrome
 * (`beforeinstallprompt`) est donc simulée, avec sa fenêtre native. Que le
 * build soit réellement installable est vérifié à part, sur le build lui-même
 * (`scripts/verifier-bundle.ts`).
 */

/** Le tableau de bord attend un moment avant de proposer : on lui laisse le temps. */
const ATTENTE = { timeout: 10_000 }

/** Assez pour que la proposition d'office ait eu lieu, si elle devait avoir lieu. */
const APRES_LE_DELAI_MS = 4_500

/** Le navigateur propose l'installation. `prompt()` compte ses appels, la réponse est au choix. */
async function inviterAInstaller(page: Page, issue: 'accepted' | 'dismissed' = 'accepted') {
  await page.evaluate((reponse) => {
    const fenetre = window as unknown as { __invitationsOuvertes: number }
    fenetre.__invitationsOuvertes = 0
    const evenement = new Event('beforeinstallprompt', { cancelable: true }) as Event & Record<string, unknown>
    evenement.prompt = async () => {
      fenetre.__invitationsOuvertes++
    }
    evenement.userChoice = Promise.resolve({ outcome: reponse, platform: 'web' })
    window.dispatchEvent(evenement)
  }, issue)
}

async function surLeTableauDeBord(page: Page) {
  await seConnecter(page)
  if (new URL(page.url()).pathname !== '/app') await page.goto('/app')
  await waitForHydration(page)
}

const fenetre = (page: Page) => page.getByTestId('fenetre-installation')
const consignes = (page: Page) => page.getByTestId('consignes-installation')

test('le navigateur invite : la fenêtre le propose d’office, et son bouton ouvre l’installation', async ({ page }) => {
  await surLeTableauDeBord(page)
  await inviterAInstaller(page)

  await expect(fenetre(page)).toBeVisible(ATTENTE)
  await expect(consignes(page)).toHaveAttribute('data-mode', 'invite')

  await page.getByTestId('bouton-installer').click()
  await expect(fenetre(page)).toBeHidden()
  expect(await page.evaluate(() => (window as unknown as { __invitationsOuvertes: number }).__invitationsOuvertes)).toBe(1)

  // Installée : le profil ne propose plus rien.
  await page.getByTestId('lien-profil').click()
  await page.waitForURL(url => url.pathname === '/app/profil')
  await expect(page.getByTestId('bouton-deconnexion')).toBeVisible()
  await expect(page.getByTestId('bouton-installer-application')).toHaveCount(0)
})

test('« Plus tard » tient : la fenêtre ne revient pas à la visite suivante', async ({ page }) => {
  await surLeTableauDeBord(page)
  await inviterAInstaller(page)

  await expect(fenetre(page)).toBeVisible(ATTENTE)
  await page.getByTestId('bouton-plus-tard-installation').click()
  await expect(fenetre(page)).toBeHidden()

  await page.reload()
  await waitForHydration(page)
  await inviterAInstaller(page)
  // Rien à attendre qui apparaisse : on laisse passer le délai, puis on constate.
  await page.waitForTimeout(APRES_LE_DELAI_MS)
  await expect(fenetre(page)).toHaveCount(0)

  // Le profil, lui, la garde à portée — avec l'invitation mise de côté,
  // qui ne survit pas à un rechargement : on y va par la navigation.
  await page.getByTestId('lien-profil').click()
  await page.waitForURL(url => url.pathname === '/app/profil')
  await page.getByTestId('bouton-installer-application').click()
  await expect(consignes(page)).toHaveAttribute('data-mode', 'invite')
})

test('refusée dans la fenêtre du navigateur, l’installation est remise à plus tard', async ({ page }) => {
  await surLeTableauDeBord(page)
  await inviterAInstaller(page, 'dismissed')

  await expect(fenetre(page)).toBeVisible(ATTENTE)
  await page.getByTestId('bouton-installer').click()
  await expect(fenetre(page)).toBeHidden()

  const report = await page.evaluate(() => localStorage.getItem('etontine-installation-refusee'))
  expect(Number(report)).toBeGreaterThan(0)
})

test('sans invitation du navigateur, rien d’office ; le profil donne la marche à suivre de l’appareil', async ({ page }, testInfo) => {
  await surLeTableauDeBord(page)
  // Chrome sans invitation : souvent parce que c'est déjà installé. On ne
  // le sait pas — on n'insiste pas.
  await page.waitForTimeout(APRES_LE_DELAI_MS)
  await expect(fenetre(page)).toHaveCount(0)

  await page.goto('/app/profil')
  await waitForHydration(page)
  await page.getByTestId('bouton-installer-application').click()

  // Le profil mobile joue Chrome sur Android, l'autre Chrome sur ordinateur.
  const mode = testInfo.project.name === 'mobile-360' ? 'android' : 'ordinateur'
  await expect(consignes(page)).toHaveAttribute('data-mode', mode)
  await expect(page.getByTestId('etapes-installation').locator('li')).toHaveCount(3)

  await page.getByTestId('bouton-compris-installation').click()
  await expect(fenetre(page)).toBeHidden()
})

test('ouverte depuis l’écran d’accueil, l’application ne propose rien', async ({ page }) => {
  // L'application installée s'affiche en `display-mode: standalone`. La vraie
  // liste est gardée, ses méthodes comprises — d'autres s'y abonnent.
  await page.addInitScript(() => {
    const origine = window.matchMedia.bind(window)
    window.matchMedia = (requete: string) => {
      const liste = origine(requete)
      if (requete.includes('display-mode: standalone')) Object.defineProperty(liste, 'matches', { get: () => true })
      return liste
    }
  })

  await surLeTableauDeBord(page)
  await inviterAInstaller(page)
  await page.waitForTimeout(APRES_LE_DELAI_MS)
  await expect(fenetre(page)).toHaveCount(0)

  await page.goto('/app/profil')
  await waitForHydration(page)
  await expect(page.getByTestId('bouton-deconnexion')).toBeVisible()
  await expect(page.getByTestId('bouton-installer-application')).toHaveCount(0)
})

test.describe('sur iPhone', () => {
  test.use({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  })

  test('aucune invitation n’existe : la fenêtre montre le bouton Partager, puis « Sur l’écran d’accueil »', async ({ page }) => {
    await surLeTableauDeBord(page)

    await expect(fenetre(page)).toBeVisible(ATTENTE)
    await expect(consignes(page)).toHaveAttribute('data-mode', 'ios')
    const etapes = page.getByTestId('etapes-installation').locator('li')
    await expect(etapes).toHaveCount(3)
    await expect(etapes.nth(0)).toContainText('Partager')
    await expect(etapes.nth(1)).toContainText('Sur l’écran d’accueil')
    await expect(etapes.nth(2)).toContainText('Ajouter')

    await page.getByTestId('bouton-compris-installation').click()
    await expect(fenetre(page)).toBeHidden()
  })
})

test.describe('dans le navigateur de Facebook', () => {
  test.use({
    userAgent: 'Mozilla/5.0 (Linux; Android 13; SM-A135F Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.81 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/485.0.0.70.77;]',
    permissions: ['clipboard-read', 'clipboard-write'],
  })

  test('il ne sait pas installer : la fenêtre donne le lien à rouvrir dans le navigateur, prêt à copier', async ({ page, baseURL }) => {
    await surLeTableauDeBord(page)

    await expect(fenetre(page)).toBeVisible(ATTENTE)
    await expect(consignes(page)).toHaveAttribute('data-mode', 'navigateur-integre')
    await expect(page.getByTestId('adresse-installation')).toHaveText(`${baseURL}/app`)

    await page.getByTestId('bouton-copier-lien-installation').click()
    await expect(page.getByTestId('bouton-copier-lien-installation')).toHaveText('Lien copié')
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${baseURL}/app`)
  })
})

test('la page d’aide explique comment installer', async ({ page }) => {
  await page.goto('/aide')
  await expect(page.getByText('Comment installer eTontine sur mon téléphone ?')).toBeVisible()
})
