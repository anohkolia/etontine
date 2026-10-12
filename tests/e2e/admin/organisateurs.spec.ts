import { expect, test } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { waitForHydration } from '../helpers/hydration'
import { numeroDeTest } from '../helpers/telephone'
import { CODE_TEST, emailDeTest } from '../helpers/session'

/**
 * Back-office — les organisateurs.
 *
 * Qui s'inscrit sans lien d'invitation vient organiser une tontine : il doit
 * apparaître ici, signalé, jusqu'à ce qu'un administrateur le prenne en
 * compte. Qui s'inscrit par un lien est un membre : il n'a rien à y faire.
 */

const APP_MEMBRE = 'http://localhost:3000'

/** La forme d'un jeton de lien d'invitation. Le serveur ne s'en sert que pour dire d'où l'on vient. */
const INVITATION = 'Zx9_kQ2-mN4pL7wR1tY6vA'

/**
 * Ces tests pilotent deux applications, dont les serveurs de développement
 * compilent à la demande : le délai par défaut y suffit à peine.
 */
test.slow()

/**
 * Inscrit et confirme un compte sur l'application des membres.
 *
 * Dans un contexte **vierge** : le cookie de session vaut pour `localhost`
 * sans distinction de port, et la confirmation ouvrirait une session de
 * membre par-dessus celle de l'administrateur.
 */
async function inscrireSurAppMembre(browser: Browser, invitation?: string): Promise<string> {
  const contexte = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const page = await contexte.newPage()
  const numero = numeroDeTest()

  const inscription = await page.request.post(`${APP_MEMBRE}/api/v1/auth/register`, {
    data: { phone: numero, email: emailDeTest(numero), code: CODE_TEST, ...(invitation ? { invitation } : {}) },
  })
  if (!inscription.ok()) throw new Error(`inscription refusée : ${await inscription.text()}`)
  const { devToken } = await inscription.json() as { devToken?: string }

  const confirmation = await page.request.post(`${APP_MEMBRE}/api/v1/auth/confirm`, { data: { token: devToken } })
  if (!confirmation.ok()) throw new Error(`confirmation refusée : ${await confirmation.text()}`)

  await contexte.close()
  return `+225${numero}`
}

const cartes = (page: Page, numero: string) =>
  page.locator('[data-testid^="organisateur-"]').filter({ hasText: numero })

test('un organisateur qui s’inscrit apparaît parmi les nouveaux, et l’onglet le signale ; un membre invité, non', async ({ page, browser }) => {
  const organisateur = await inscrireSurAppMembre(browser)
  const membre = await inscrireSurAppMembre(browser, INVITATION)

  // Le badge se voit depuis n'importe quel écran du back-office.
  await page.goto('/dossiers')
  await waitForHydration(page)
  await expect(page.getByTestId('alertes-organisateurs')).toBeVisible()

  await page.getByTestId('onglet-organisateurs').click()
  await page.waitForURL(url => url.pathname === '/organisateurs')

  const carte = cartes(page, organisateur)
  await expect(carte).toHaveCount(1)
  await expect(carte).toContainText('Identité non vérifiée')
  await expect(carte).toContainText('Aucune tontine pour l’instant')

  // La liste est chargée — l'organisateur y est : l'absence du membre dit
  // quelque chose.
  await expect(cartes(page, membre)).toHaveCount(0)
})

test('prendre en compte retire l’arrivée de la file, et le geste est journalisé', async ({ page, browser }) => {
  const organisateur = await inscrireSurAppMembre(browser)

  await page.goto('/organisateurs')
  await waitForHydration(page)

  const carte = cartes(page, organisateur)
  await expect(carte).toHaveCount(1)
  await carte.getByTestId(/^prendre-en-compte-/).click()
  await expect(cartes(page, organisateur)).toHaveCount(0)

  // Il reste dans la liste complète, avec la trace de la prise en compte.
  await page.getByTestId('filtre-tous').click()
  await expect(cartes(page, organisateur)).toContainText('Pris en compte le')

  await page.goto('/journal')
  await waitForHydration(page)
  const entree = page.getByTestId('journal-organisateur_pris_en_compte').first()
  await expect(entree).toContainText('Organisateur pris en compte')
  await expect(entree).toContainText('+2250500000001')
})
