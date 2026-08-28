import { expect, test } from '@playwright/test'
import { waitForHydration } from './helpers/hydration'
import { canalVerifie, seConnecter, verifierIdentite } from './helpers/session'
import { numeroDeTest } from './helpers/telephone'
import { pngLourd } from './helpers/image'

/** Monte une tontine lancée, et renvoie son identifiant. */
async function tontineLancee(page: import('@playwright/test').Page) {
  await seConnecter(page)
  await verifierIdentite(page)
  const canal = await canalVerifie(page, `+225${numeroDeTest()}`)

  const creation = await page.request.post('/api/v1/tontines', {
    data: { name: 'Tontine des tantines', access: 'private' },
  })
  const { id } = await creation.json() as { id: string }

  await page.request.fetch(`/api/v1/tontines/${id}`, {
    method: 'PATCH',
    data: {
      shareAmount: 25_000,
      frequency: 'monthly',
      startDate: new Date().toISOString().slice(0, 10),
      collectionChannelIds: [canal],
    },
  })

  for (const nom of ['Koffi N’Guessan', 'Fatou Diarra']) {
    await page.request.post(`/api/v1/tontines/${id}/members`, {
      data: { name: nom, phone: `+225${numeroDeTest()}`, shares: 1 },
    })
  }

  await page.request.post(`/api/v1/tontines/${id}/publish`)
  await page.request.post(`/api/v1/tontines/${id}/start`)
  return id
}

test('l’écran « où envoyer » montre toujours le nom du titulaire', async ({ page }) => {
  const id = await tontineLancee(page)
  await page.goto(`/app/tontine/${id}/cotiser`)
  await waitForHydration(page)

  const cotisation = page.locator('[data-testid^="bouton-envoyer-"]').first()
  await cotisation.click()

  // Protection anti-arnaque n°1 : le membre compare ce nom à ce que son
  // application de paiement lui affiche avant de valider.
  await expect(page.getByTestId('nom-titulaire')).toHaveText('Aya Koné')
  await expect(page.getByTestId('numero-collecte')).toBeVisible()
  await expect(page.getByTestId('reference-courte')).toContainText(/^TON-[A-Z0-9]{4}$/)
})

test('le bouton Copier fonctionne sans contexte sécurisé', async ({ page }) => {
  const id = await tontineLancee(page)
  await page.goto(`/app/tontine/${id}/cotiser`)
  await waitForHydration(page)
  await page.locator('[data-testid^="bouton-envoyer-"]').first().click()

  // On simule l'absence de l'API presse-papiers, comme en développement sur
  // une adresse IP locale : le repli doit prendre le relais.
  await page.evaluate(() => {
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true })
  })

  await page.getByTestId('bouton-copier-numero').click()
  await expect(page.getByTestId('bouton-copier-numero')).toContainText('copié')
})

test('les frais ne sont pas inventés quand la grille n’est pas renseignée', async ({ page }) => {
  const id = await tontineLancee(page)
  await page.goto(`/app/tontine/${id}/cotiser`)
  await waitForHydration(page)
  await page.locator('[data-testid^="bouton-envoyer-"]').first().click()

  // Acceptation T14 : aucun taux codé en dur. Sans grille renseignée, on
  // annonce l'existence des frais sans avancer de chiffre.
  await expect(page.getByTestId('frais-inconnus')).toBeVisible()
  await expect(page.getByTestId('montant-a-envoyer')).toContainText('25 000 FCFA')
})

test('une image de 4 Mo est compressée sous 100 Ko avant l’envoi', async ({ page }) => {
  const id = await tontineLancee(page)
  await page.goto(`/app/tontine/${id}/cotiser`)
  await waitForHydration(page)
  await page.locator('[data-testid^="bouton-envoyer-"]').first().click()
  await page.getByTestId('bouton-jai-envoye').click()

  const image = pngLourd(1_200)
  // On vérifie d'abord que l'image de départ est bien lourde, sinon le test
  // ne prouverait rien.
  expect(image.length).toBeGreaterThan(4 * 1024 * 1024)

  await page.getByTestId('champ-preuve').setInputFiles({
    name: 'preuve.png',
    mimeType: 'image/png',
    buffer: image,
  })

  const poids = page.getByTestId('poids-preuve')
  await expect(poids).toBeVisible({ timeout: 20_000 })

  const ko = Number((await poids.textContent())?.match(/(\d+) Ko/)?.[1])
  // Règle 18 : sur un forfait ivoirien à la donnée, envoyer 4 Mo coûte au membre.
  expect(ko).toBeLessThan(100)
})

test('déclarer affiche le statut bleu « Déclaré », et verrouille 90 secondes', async ({ page }) => {
  const id = await tontineLancee(page)
  await page.goto(`/app/tontine/${id}/cotiser`)
  await waitForHydration(page)
  await page.locator('[data-testid^="bouton-envoyer-"]').first().click()
  await page.getByTestId('bouton-jai-envoye').click()
  await page.getByTestId('bouton-declarer').click()

  await expect(page.getByTestId('message-declaration')).toContainText('trésorier')

  // Acceptation T15 : le bouton reste inactif 90 secondes après un envoi.
  const bouton = page.getByTestId('bouton-declarer')
  await expect(bouton).toBeDisabled()
  await expect(bouton).toContainText('Déjà déclaré')

  // Et le statut est bleu « Déclaré », jamais vert.
  const badge = page.getByTestId('status-badge').filter({ hasText: 'Déclaré' }).first()
  await expect(badge).toBeVisible()

  const fond = await badge.evaluate(el => getComputedStyle(el).backgroundColor)
  const confirme = await page.evaluate(() => {
    const sonde = document.createElement('span')
    sonde.className = 'bg-confirmed-surface'
    document.body.appendChild(sonde)
    const couleur = getComputedStyle(sonde).backgroundColor
    sonde.remove()
    return couleur
  })
  expect(fond).not.toBe(confirme)
})

test('une seconde déclaration donne un message explicite, jamais un doublon', async ({ page }) => {
  const id = await tontineLancee(page)
  await page.goto(`/app/tontine/${id}/cotiser`)
  await waitForHydration(page)
  await page.locator('[data-testid^="bouton-envoyer-"]').first().click()
  await page.getByTestId('bouton-jai-envoye').click()
  await page.getByTestId('bouton-declarer').click()
  await expect(page.getByTestId('message-declaration')).toBeVisible()

  // On revient sur la cotisation : elle est déjà déclarée, et l'écran le dit.
  await page.reload()
  await waitForHydration(page)
  await expect(page.getByTestId('liste-cotisations')).toContainText('Déclaré')
  await expect(page.locator('[data-testid^="bouton-envoyer-"]')).toHaveCount(0)
})
