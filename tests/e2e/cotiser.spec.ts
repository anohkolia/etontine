import { expect, test } from '@playwright/test'
import { waitForHydration } from './helpers/hydration'
import { tontineLanceeAvecCotisant } from './helpers/tontine'
import { pngLourd } from './helpers/image'

/**
 * L'écran « cotiser » est celui d'un membre : le président ne cotise pas.
 * Chaque test pilote la page de Koffi, sur une tontine lancée par un
 * président dans un contexte à part.
 */

test('l’écran « où envoyer » montre toujours le nom du titulaire', async ({ page, browser }) => {
  const { id } = await tontineLanceeAvecCotisant(browser, page)
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

test('le bouton Copier fonctionne sans contexte sécurisé', async ({ page, browser }) => {
  const { id } = await tontineLanceeAvecCotisant(browser, page)
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

test('l’écran de paiement n’affiche aucun frais', async ({ page, browser }) => {
  const { id } = await tontineLanceeAvecCotisant(browser, page)
  await page.goto(`/app/tontine/${id}/cotiser`)
  await waitForHydration(page)
  await page.locator('[data-testid^="bouton-envoyer-"]').first().click()

  // Le membre supporte les frais dans tous les cas et en connaît l'ordre de
  // grandeur : une estimation n'ajouterait qu'un chiffre approximatif là où la
  // charge mentale doit être la plus basse. Et un chiffre faux lui ferait
  // envoyer le mauvais montant.
  await expect(page.getByTestId('montant-a-envoyer')).toHaveText('25 000 FCFA')

  const ecran = await page.locator('[data-testid="section-inputotp"], main').first().textContent()
  expect(ecran).not.toMatch(/frais/i)
})

test('une image de 4 Mo est compressée sous 100 Ko avant l’envoi', async ({ page, browser }) => {
  const { id } = await tontineLanceeAvecCotisant(browser, page)
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

test('déclarer verrouille 90 secondes, et rien ne se confirme tout seul', async ({ page, browser }) => {
  const { id } = await tontineLanceeAvecCotisant(browser, page)
  await page.goto(`/app/tontine/${id}/cotiser`)
  await waitForHydration(page)
  await page.locator('[data-testid^="bouton-envoyer-"]').first().click()
  await page.getByTestId('bouton-jai-envoye').click()
  await page.getByTestId('bouton-declarer').click()

  // Le président — qui ne cotise pas — confirmera : la déclaration attend, et
  // l'écran le dit. Rien n'est jamais confirmé « d'office ».
  await expect(page.getByTestId('message-declaration')).toContainText('trésorier')

  // Acceptation T15 : le bouton reste inactif 90 secondes après un envoi.
  const bouton = page.getByTestId('bouton-declarer')
  await expect(bouton).toBeDisabled()
  await expect(bouton).toContainText('Déjà déclaré')

  // Bleu « Déclaré », jamais le vert du confirmé.
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

test('une seconde déclaration donne un message explicite, jamais un doublon', async ({ page, browser }) => {
  const { id } = await tontineLanceeAvecCotisant(browser, page)
  await page.goto(`/app/tontine/${id}/cotiser`)
  await waitForHydration(page)
  await page.locator('[data-testid^="bouton-envoyer-"]').first().click()
  await page.getByTestId('bouton-jai-envoye').click()
  await page.getByTestId('bouton-declarer').click()
  await expect(page.getByTestId('message-declaration')).toBeVisible()

  // On revient sur la cotisation : elle est déjà déclarée, et l'écran le dit
  // sans proposer d'envoyer une seconde fois.
  await page.reload()
  await waitForHydration(page)
  await expect(page.getByTestId('liste-cotisations')).toContainText('Déclaré')
  await expect(page.locator('[data-testid^="bouton-envoyer-"]')).toHaveCount(0)
})
