import { expect, test } from '@playwright/test'
import { waitForHydration } from './helpers/hydration'
import { canalDeclare, seConnecter, renseignerNom, verifierIdentite } from './helpers/session'
import { numeroDeTest } from './helpers/telephone'

test('le wizard s’ouvre sur les informations : il n’y a plus d’accès « ouvert » à choisir', async ({ page }) => {
  await seConnecter(page)
  await renseignerNom(page)
  await canalDeclare(page, `+225${numeroDeTest()}`)

  await page.goto('/app/tontine/create')
  await waitForHydration(page)

  // On ne rejoint une tontine que par le lien de son organisateur : l'étape
  // où l'on choisissait une tontine « ouverte » a disparu avec l'option.
  await expect(page.getByTestId('etape-courante')).toContainText('Étape 1 sur 5 — Informations')
  await expect(page.getByTestId('etape-informations')).toBeVisible()
  await expect(page.getByTestId('acces-ouvert')).toHaveCount(0)
  await expect(page.getByText('Tontine ouverte')).toHaveCount(0)

  // Jusqu'au récapitulatif, qui dit le seul accès qui reste.
  await page.getByTestId('champ-nom-tontine').fill('Tontine des tantines')
  await page.getByTestId('bouton-continuer').click()
  await page.getByTestId('champ-montant').fill('10000')
  await page.locator('[data-testid^="canal-"]').first().check()
  await page.getByTestId('bouton-continuer').click()
  await expect(page.getByTestId('etape-ordre')).toBeVisible()
  await page.getByTestId('bouton-continuer').click()
  await expect(page.getByTestId('etape-regles')).toBeVisible()
  await page.getByTestId('bouton-continuer').click()

  await expect(page.getByTestId('etape-courante')).toContainText('Étape 5 sur 5')
  await expect(page.getByTestId('recap-acces')).toHaveText('Sur invitation. Personne ne la trouve sans ton lien.')
})

test('l’API refuse elle aussi l’accès « ouvert »', async ({ page }) => {
  await seConnecter(page)
  await verifierIdentite(page)

  // Masquer l'option ne suffit pas : la route doit la refuser, même à un
  // organisateur vérifié.
  const creation = await page.request.post('/api/v1/tontines', {
    data: { name: 'Tontine ouverte à tous', access: 'open' },
  })
  expect(creation.status()).toBe(422)
})

test('le simulateur se met à jour à chaque frappe', async ({ page }) => {
  await seConnecter(page)
  await verifierIdentite(page)
  await canalDeclare(page, `+225${numeroDeTest()}`)

  await page.goto('/app/tontine/create')
  await waitForHydration(page)

  await page.getByTestId('champ-nom-tontine').fill('Tontine des tantines')
  await page.getByTestId('bouton-continuer').click()

  await expect(page.getByTestId('etape-argent')).toBeVisible()
  await page.getByTestId('champ-montant').fill('10000')
  await page.getByTestId('champ-membres').fill('12')

  // Acceptation T10 : « 12 × 10 000 FCFA = 120 000 FCFA par tour, sur 12 mois ».
  const simulateur = page.getByTestId('simulateur')
  await expect(simulateur).toContainText('12 ×')
  await expect(simulateur).toContainText('10 000 FCFA')
  await expect(simulateur).toContainText('120 000 FCFA')
  await expect(simulateur).toContainText('sur 12 mois')

  // Une frappe de plus, et la simulation suit immédiatement.
  await page.getByTestId('champ-montant').fill('20000')
  await expect(simulateur).toContainText('240 000 FCFA')
})

test('l’alerte de plafond apparaît quand le pot devient gros', async ({ page }) => {
  await seConnecter(page)
  await verifierIdentite(page)
  await canalDeclare(page, `+225${numeroDeTest()}`)

  await page.goto('/app/tontine/create')
  await waitForHydration(page)
  await page.getByTestId('champ-nom-tontine').fill('Grosse tontine')
  await page.getByTestId('bouton-continuer').click()

  await page.getByTestId('champ-montant').fill('10000')
  await expect(page.getByTestId('alerte-plafond')).toBeHidden()

  // Un compte de monnaie électronique est plafonné : l'organisateur doit le
  // savoir avant de démarrer, pas au troisième tour.
  await page.getByTestId('champ-montant').fill('100000')
  await expect(page.getByTestId('alerte-plafond')).toBeVisible()
  await expect(page.getByTestId('alerte-plafond')).toContainText('plafond')
})

test('fermer et rouvrir l’application restaure le brouillon à la bonne étape', async ({ page }) => {
  await seConnecter(page)
  await verifierIdentite(page)
  await canalDeclare(page, `+225${numeroDeTest()}`)

  await page.goto('/app/tontine/create')
  await waitForHydration(page)
  await page.getByTestId('champ-nom-tontine').fill('Tontine des tantines')
  await page.getByTestId('bouton-continuer').click()

  await expect(page.getByTestId('etape-courante')).toContainText('Étape 2 sur 5')
  await page.getByTestId('champ-montant').fill('25000')
  await page.getByTestId('bouton-retour').click()

  // On quitte l'application, puis on revient : acceptation T10.
  await page.goto('/app')
  await page.goto('/app/tontine/create')
  await waitForHydration(page)

  await expect(page.getByTestId('etape-courante')).toContainText('Étape 1 sur 5')
  // Le nom vient du serveur, pas du navigateur : c'est là qu'il fait foi.
  await expect(page.getByTestId('champ-nom-tontine')).toHaveValue('Tontine des tantines')
})
