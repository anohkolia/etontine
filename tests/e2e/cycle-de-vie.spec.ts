import { expect, test } from '@playwright/test'
import { waitForHydration } from './helpers/hydration'
import { numeroDeTest } from './helpers/telephone'
import { canalVerifie, seConnecter, verifierIdentite } from './helpers/session'
import { inscriptionOtp, rattacherMembre, tontinePubliee } from './helpers/tontine'
import { terminerTontine } from './helpers/base'

/**
 * Le cycle de vie d'une tontine, hors de la voie heureuse : la date du premier
 * tour, l'annulation avant démarrage, la suppression d'un brouillon, la fin
 * d'un cycle. Aucun de ces chemins n'existait — une tontine publiée jamais
 * démarrée gardait sa place au quota pour toujours.
 */

const HIER = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
const DANS_UN_MOIS = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)

test('le wizard demande la date du premier tour et refuse le passé', async ({ page }) => {
  await seConnecter(page)
  await verifierIdentite(page)
  await canalVerifie(page, `+225${numeroDeTest()}`)

  await page.goto('/app/tontine/create')
  await waitForHydration(page)

  await page.getByTestId('bouton-continuer').click()
  await page.getByTestId('champ-nom-tontine').fill('Tontine des tantines')
  await page.getByTestId('bouton-continuer').click()

  await expect(page.getByTestId('etape-argent')).toBeVisible()
  await page.getByTestId('champ-montant').fill('10000')
  await page.locator('[data-testid^="canal-"]').first().check()

  // Une date passée est signalée et bloque l'étape.
  await page.getByTestId('champ-date-demarrage').fill(HIER)
  await expect(page.getByTestId('erreur-date-demarrage')).toBeVisible()
  await expect(page.getByTestId('bouton-continuer')).toBeDisabled()

  await page.getByTestId('champ-date-demarrage').fill(DANS_UN_MOIS)
  await expect(page.getByTestId('erreur-date-demarrage')).toBeHidden()
  await expect(page.getByTestId('bouton-continuer')).toBeEnabled()
})

test('une date de départ passée bloque le démarrage, jusqu’à ce qu’on la change', async ({ page }) => {
  await inscriptionOtp(page)
  const { id } = await tontinePubliee(page, [
    { nom: 'Koffi N’Guessan', numero: numeroDeTest() },
    { nom: 'Fatou Diarra', numero: numeroDeTest() },
  ], { startDate: HIER })

  await page.goto(`/app/tontine/${id}/membres`)
  await waitForHydration(page)

  // L'écran dit la date, dit ce qui bloque, et n'offre pas un bouton mort.
  await expect(page.getByTestId('date-premier-tour')).toBeVisible()
  await expect(page.getByTestId('blocages-demarrage')).toContainText('date de démarrage est passée')
  await expect(page.getByTestId('bouton-demarrer')).toBeDisabled()

  await page.getByTestId('lien-changer-date').click()
  await page.waitForURL(/\/reglages/)
  await waitForHydration(page)
  await page.getByTestId('champ-date-demarrage').fill(DANS_UN_MOIS)
  await page.getByTestId('bouton-enregistrer-reglages').click()
  await expect(page.getByTestId('reglages-enregistres')).toBeVisible()

  await page.goto(`/app/tontine/${id}/membres`)
  await waitForHydration(page)
  await expect(page.getByTestId('blocages-demarrage')).toHaveCount(0)
  await expect(page.getByTestId('bouton-demarrer')).toBeEnabled()
  await page.getByTestId('bouton-demarrer').click()

  // Démarrée : le détail montre un tour ouvert à la date choisie.
  await page.goto(`/app/tontine/${id}`)
  await waitForHydration(page)
  await expect(page.getByTestId('bloc-tour')).toBeVisible()
})

test('annuler une tontine publiée la retire du tableau de bord et prévient les membres', async ({ page, browser }) => {
  await inscriptionOtp(page)
  const numeroKoffi = numeroDeTest()
  const { id, lien } = await tontinePubliee(page, [
    { nom: 'Koffi N’Guessan', numero: numeroKoffi },
    { nom: 'Fatou Diarra', numero: numeroDeTest() },
  ])
  const koffi = await rattacherMembre(browser, lien, numeroKoffi, 'Koffi', 'N’Guessan')

  await page.goto(`/app/tontine/${id}/reglages`)
  await waitForHydration(page)
  await page.getByTestId('bouton-annuler-tontine').click()
  // Sans motif, pas d'annulation : il part au registre et aux membres.
  await expect(page.getByTestId('bouton-confirmer-annulation')).toBeDisabled()
  await page.getByTestId('champ-motif-annulation').fill('Le groupe ne s’est pas réuni')
  await page.getByTestId('bouton-confirmer-annulation').click()

  await page.waitForURL(url => url.pathname === '/app')
  await waitForHydration(page)
  await expect(page.getByTestId(`carte-tontine-${id}`)).toHaveCount(0)

  await koffi.page.goto('/app/notifications')
  await waitForHydration(koffi.page)
  await expect(koffi.page.locator('body')).toContainText('annulée')

  await koffi.contexte.close()
})

test('une tontine en cours ne s’annule pas, et l’écran le dit', async ({ page }) => {
  await inscriptionOtp(page)
  const { id } = await tontinePubliee(page, [
    { nom: 'Koffi N’Guessan', numero: numeroDeTest() },
    { nom: 'Fatou Diarra', numero: numeroDeTest() },
  ])
  await page.request.post(`/api/v1/tontines/${id}/start`)

  await page.goto(`/app/tontine/${id}/reglages`)
  await waitForHydration(page)
  await expect(page.getByTestId('fin-impossible')).toContainText('au bout de son cycle')
  await expect(page.getByTestId('bouton-annuler-tontine')).toHaveCount(0)
})

test('supprimer un brouillon', async ({ page }) => {
  await seConnecter(page)
  await verifierIdentite(page)
  const creation = await page.request.post('/api/v1/tontines', {
    data: { name: 'Brouillon par erreur', access: 'private' },
  })
  const { id } = await creation.json() as { id: string }

  await page.goto(`/app/tontine/${id}/reglages`)
  await waitForHydration(page)
  await page.getByTestId('bouton-supprimer-brouillon').click()
  await page.getByTestId('bouton-confirmer-suppression').click()

  await page.waitForURL(url => url.pathname === '/app')
  expect((await page.request.get(`/api/v1/tontines/${id}`)).status()).toBe(404)
})

test('une tontine terminée est rangée à part, puis archivée', async ({ page }) => {
  await inscriptionOtp(page)
  const { id } = await tontinePubliee(page, [
    { nom: 'Koffi N’Guessan', numero: numeroDeTest() },
    { nom: 'Fatou Diarra', numero: numeroDeTest() },
  ], { nom: 'Tontine finie' })
  await page.request.post(`/api/v1/tontines/${id}/start`)
  await terminerTontine(id)

  await page.goto('/app')
  await waitForHydration(page)
  // Rangée sous « Terminées », pas parmi les tontines en cours.
  await expect(page.getByTestId('liste-tontines')).not.toContainText('Tontine finie')
  await page.getByTestId('bouton-terminees').click()
  await expect(page.getByTestId('liste-terminees')).toContainText('Tontine finie')

  await page.getByTestId(`lien-tontine-${id}`).click()
  await page.waitForURL(new RegExp(`/app/tontine/${id}$`))
  await waitForHydration(page)
  await expect(page.getByTestId('tontine-terminee')).toContainText('terminée')

  await page.getByTestId('bouton-archiver').click()
  await page.waitForURL(url => url.pathname === '/app')
  await waitForHydration(page)
  await expect(page.getByTestId('tontines-terminees')).toHaveCount(0)
})
