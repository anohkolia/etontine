import { expect, test } from '@playwright/test'
import { waitForHydration } from './helpers/hydration'
import { canalVerifie, renseignerNom, seConnecter } from './helpers/session'
import { numeroDeTest } from './helpers/telephone'

/**
 * Vérification d'identité : la sortie depuis le wizard, et le dépôt des pièces.
 *
 * L'enjeu du premier test est un cul-de-sac réel : l'organisateur remplit six
 * écrans, appuie sur « Publier », et se voit refuser pour un palier manquant.
 * Sans chemin depuis ce bandeau, il lui reste à deviner qu'il faut passer par
 * son profil.
 */

/**
 * La caméra du poste de test : un flux de synthèse, autorisé d'office.
 *
 * Posé au niveau du fichier — Playwright refuse `launchOptions` dans un
 * `describe`, qui forcerait un nouveau worker en cours de route.
 */
test.use({
  launchOptions: {
    args: ['--use-fake-device-for-media-capture', '--use-fake-ui-for-media-stream'],
  },
  permissions: ['camera'],
})

/** Mène le wizard jusqu'au récapitulatif, sans publier. */
async function allerAuRecapitulatif(page: import('@playwright/test').Page) {
  const canal = await canalVerifie(page, `+225${numeroDeTest()}`)

  await page.goto('/app/tontine/create')
  await waitForHydration(page)

  // Étape 0 — accès
  await page.getByTestId('bouton-continuer').click()

  // Étape 1 — informations
  await page.getByTestId('champ-nom-tontine').fill('Tontine des tantines')
  await page.getByTestId('bouton-continuer').click()

  // Étape 2 — argent
  await expect(page.getByTestId('etape-argent')).toBeVisible()
  await page.getByTestId('champ-montant').fill('1100')
  await page.getByTestId(`canal-${canal}`).check()
  await page.getByTestId('bouton-continuer').click()

  // Étapes 3 et 4 — ordre de passage, puis règles
  await expect(page.getByTestId('etape-ordre')).toBeVisible()
  await page.getByTestId('bouton-continuer').click()
  await expect(page.getByTestId('etape-regles')).toBeVisible()
  await page.getByTestId('bouton-continuer').click()

  await expect(page.getByTestId('etape-recapitulatif')).toBeVisible()
}

test('le refus pour palier manquant offre le chemin vers la vérification', async ({ page }) => {
  await seConnecter(page)
  // Palier 1 seulement : de quoi ouvrir le wizard, pas de quoi publier.
  await renseignerNom(page)

  await allerAuRecapitulatif(page)
  await page.getByTestId('bouton-publier').click()

  const bandeau = page.getByTestId('erreur-wizard')
  await expect(bandeau).toContainText('pièce d’identité')

  const lien = page.getByTestId('lien-verifier-identite')
  await expect(lien).toBeVisible()
  await lien.click()

  // Et le retour est prévu : la vérification ramène là où l'on s'est arrêté.
  await page.waitForURL(url => url.pathname === '/app/profil/identite')
  expect(new URL(page.url()).searchParams.get('redirect')).toBe('/app/tontine/create')
})

test('une erreur ordinaire n’affiche pas le bouton de vérification', async ({ page }) => {
  await seConnecter(page)
  await renseignerNom(page)

  await page.goto('/app/tontine/create')
  await waitForHydration(page)
  await page.getByTestId('bouton-continuer').click()

  // Un nom déjà refusé côté serveur : l'erreur n'a rien à voir avec le palier,
  // et proposer d'aller vérifier son identité enverrait sur une fausse piste.
  await page.route('**/api/v1/tontines', route => route.fulfill({
    status: 400,
    contentType: 'application/json',
    body: JSON.stringify({ error: { code: 'VALIDATION_ERROR', message: 'Nom déjà pris.' } }),
  }))

  await page.getByTestId('champ-nom-tontine').fill('Tontine des tantines')
  await page.getByTestId('bouton-continuer').click()

  await expect(page.getByTestId('erreur-wizard')).toContainText('Nom déjà pris.')
  await expect(page.getByTestId('lien-verifier-identite')).toBeHidden()
})

test.describe('dépôt des pièces', () => {
  test('une pièce en PDF et un selfie pris à la caméra suffisent', async ({ page }) => {
    await seConnecter(page)
    await renseignerNom(page)

    await page.goto('/app/profil/identite')
    await waitForHydration(page)

    // Le PDF part tel quel : un scan ne se comprime pas dans le navigateur.
    await page.getByTestId('champ-piece').setInputFiles({
      name: 'cni.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n%%EOF\n'),
    })
    await expect(page.getByTestId('piece-retenue')).toContainText('cni.pdf')

    // Tant que le selfie manque, on n'envoie rien.
    await expect(page.getByTestId('bouton-envoyer-identite')).toBeDisabled()

    await page.getByTestId('bouton-ouvrir-camera').click()
    await expect(page.getByTestId('camera-selfie')).toBeVisible()
    await page.getByTestId('bouton-capturer-selfie').click()

    await expect(page.getByTestId('apercu-selfie')).toBeVisible()
    await expect(page.getByTestId('poids-selfie')).toContainText('Ko')

    await page.getByTestId('bouton-envoyer-identite').click()
    await expect(page.getByTestId('resultat-identite')).toContainText('Identité vérifiée')
  })

  test('un format refusé le dit, et ne retient rien', async ({ page }) => {
    await seConnecter(page)
    await renseignerNom(page)

    await page.goto('/app/profil/identite')
    await waitForHydration(page)

    await page.getByTestId('champ-piece').setInputFiles({
      name: 'contrat.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: Buffer.from('PK'),
    })

    await expect(page.getByTestId('erreur-identite')).toContainText('PDF, JPG, JPEG et PNG')
    await expect(page.getByTestId('piece-retenue')).toBeHidden()
    await expect(page.getByTestId('bouton-envoyer-identite')).toBeDisabled()
  })
})
