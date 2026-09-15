import { expect, test } from '@playwright/test'
import { waitForHydration } from './helpers/hydration'
import { seConnecter } from './helpers/session'

/**
 * Ce qu'une mise en production exige et que rien ne fournissait : des pages
 * légales lisibles sans compte, reliées depuis les endroits où l'on consent,
 * et une demande d'abonnement qui dit où régler.
 */

test.describe('pages légales', () => {
  test('se lisent sans compte, et se relient entre elles', async ({ page }) => {
    await page.goto('/legal/confidentialite')
    await waitForHydration(page)
    await expect(page.getByTestId('legal-titre')).toHaveText('Confidentialité')
    // La loi applicable est nommée : c'est ce qui fait du texte une politique
    // et pas un pense-bête.
    await expect(page.locator('main')).toContainText('2013-450')

    await page.getByRole('link', { name: 'Conditions d’utilisation' }).click()
    await page.waitForURL(/\/legal\/cgu/)
    await waitForHydration(page)
    await expect(page.locator('main')).toContainText('ne détient jamais d’argent')

    await page.getByRole('link', { name: 'Mentions légales' }).click()
    await page.waitForURL(/\/legal\/mentions/)
    await waitForHydration(page)
    await expect(page.getByTestId('editeur-nom')).toBeVisible()
  })

  test('sont reliées depuis la landing, la connexion et le consentement', async ({ page }) => {
    await page.goto('/')
    await waitForHydration(page)
    await expect(page.getByTestId('lien-cgu')).toHaveAttribute('href', '/legal/cgu')
    await expect(page.getByTestId('lien-confidentialite')).toHaveAttribute('href', '/legal/confidentialite')

    await page.goto('/login')
    await waitForHydration(page)
    await expect(page.getByTestId('lien-cgu-login')).toHaveAttribute('href', '/legal/cgu')

    await seConnecter(page)
    await page.goto('/app/profil')
    await waitForHydration(page)
    // La case « traitement de mes données » dit à quoi l'on consent.
    await expect(page.getByTestId('lien-politique-confidentialite')).toHaveAttribute('href', '/legal/confidentialite')
  })
})

test.describe('règlement de l’abonnement', () => {
  test('une demande en cours dit comment régler, avec une référence à citer', async ({ page }) => {
    await seConnecter(page)
    await page.goto('/app/abonnement')
    await waitForHydration(page)
    await page.getByTestId('demander-standard').click()
    await expect(page.getByTestId('demande-en-cours')).toBeVisible()

    // Avec ou sans numéro configuré, les instructions existent et portent la
    // référence — c'est elle que l'administrateur rapproche du paiement.
    await expect(page.getByTestId('instructions-reglement')).toBeVisible()
    await expect(page.getByTestId('reference-reglement')).toHaveText(/^ABO-[0-9A-F]{6}$/)
  })
})
