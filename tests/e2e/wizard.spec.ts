import { expect, test } from '@playwright/test'
import { waitForHydration } from './helpers/hydration'
import { canalVerifie, seConnecter, renseignerNom, verifierIdentite } from './helpers/session'
import { numeroDeTest } from './helpers/telephone'

test('sans pièce d’identité, l’option « tontine ouverte » est grisée mais visible', async ({ page }) => {
  await seConnecter(page)
  await renseignerNom(page)

  await page.goto('/app/tontine/create')
  await waitForHydration(page)

  // Acceptation T10 : l'option existe, elle est visible, et elle explique ce
  // qu'il faut pour y accéder. Ne jamais la masquer — l'organisateur doit
  // savoir qu'elle existe.
  const ouverte = page.getByTestId('acces-ouvert')
  await expect(ouverte).toBeVisible()
  await expect(ouverte).toBeDisabled()
  await expect(page.getByTestId('explication-kyc')).toContainText('pièce d’identité')

  // Et l'option privée, elle, reste choisissable.
  await expect(page.getByTestId('acces-prive')).toBeEnabled()
})

test('avec la pièce d’identité vérifiée, l’option ouverte devient choisissable', async ({ page }) => {
  await seConnecter(page)
  await verifierIdentite(page)

  await page.goto('/app/tontine/create')
  await waitForHydration(page)

  await expect(page.getByTestId('acces-ouvert')).toBeEnabled()
  await expect(page.getByTestId('explication-kyc')).toBeHidden()
})

test('le simulateur se met à jour à chaque frappe', async ({ page }) => {
  await seConnecter(page)
  await verifierIdentite(page)
  await canalVerifie(page, `+225${numeroDeTest()}`)

  await page.goto('/app/tontine/create')
  await waitForHydration(page)

  // Étape 0 → 1
  await page.getByTestId('bouton-continuer').click()
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
  await canalVerifie(page, `+225${numeroDeTest()}`)

  await page.goto('/app/tontine/create')
  await waitForHydration(page)
  await page.getByTestId('bouton-continuer').click()
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
  await canalVerifie(page, `+225${numeroDeTest()}`)

  await page.goto('/app/tontine/create')
  await waitForHydration(page)
  await page.getByTestId('bouton-continuer').click()
  await page.getByTestId('champ-nom-tontine').fill('Tontine des tantines')
  await page.getByTestId('bouton-continuer').click()

  await expect(page.getByTestId('etape-courante')).toContainText('Étape 3 sur 6')
  await page.getByTestId('champ-montant').fill('25000')
  await page.getByTestId('bouton-retour').click()

  // On quitte l'application, puis on revient : acceptation T10.
  await page.goto('/app')
  await page.goto('/app/tontine/create')
  await waitForHydration(page)

  await expect(page.getByTestId('etape-courante')).toContainText('Étape 2 sur 6')
  // Le nom vient du serveur, pas du navigateur : c'est là qu'il fait foi.
  await expect(page.getByTestId('champ-nom-tontine')).toHaveValue('Tontine des tantines')
})
