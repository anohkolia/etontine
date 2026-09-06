import { expect, test } from '@playwright/test'
import { waitForHydration } from './helpers/hydration'
import { seConnecter } from './helpers/session'

/** Le rendu imposé par la règle 7 : espace fine insécable, espace insécable, FCFA. */
const MENSUEL_STANDARD = '7 500 FCFA'
const ANNUEL_STANDARD = '75 000 FCFA'

test.describe('grille tarifaire publique', () => {
  test('s’affiche sans connexion, avec ses trois paliers', async ({ page }) => {
    await page.goto('/tarifs')
    await waitForHydration(page)

    await expect(page.getByTestId('palier-free')).toBeVisible()
    await expect(page.getByTestId('palier-standard')).toBeVisible()
    await expect(page.getByTestId('palier-plus')).toBeVisible()

    // Les quotas portent sur les deux axes à la fois.
    await expect(page.getByTestId('quota-tontines-free')).toHaveText('1')
    await expect(page.getByTestId('quota-membres-free')).toHaveText('15')
    await expect(page.getByTestId('quota-tontines-plus')).toHaveText('illimité')
  })

  test('annonce d’abord ce qui reste gratuit à tous les paliers', async ({ page }) => {
    await page.goto('/tarifs')
    await waitForHydration(page)

    // Aucune fonction de sécurité derrière le paywall : le registre, les
    // preuves et les reçus sont annoncés avant le premier prix.
    const communs = page.getByTestId('avantages-communs')
    await expect(communs).toContainText('registre')
    await expect(communs).toContainText('reçus')
  })

  test('la bascule mensuel / annuel change les prix affichés', async ({ page }) => {
    await page.goto('/tarifs')
    await waitForHydration(page)

    await expect(page.getByTestId('prix-standard')).toHaveText(MENSUEL_STANDARD)

    // On désigne l'étiquette, comme un doigt sur l'écran : le bouton radio
    // lui-même est masqué à l'œil.
    await page.getByTestId('periodicite-yearly').click()
    // Deux mois offerts : dix mensualités.
    await expect(page.getByTestId('prix-standard')).toHaveText(ANNUEL_STANDARD)
  })

  test('le singulier /tarif mène à la grille', async ({ page }) => {
    await page.goto('/tarif')
    await expect(page).toHaveURL(/\/tarifs$/)
  })
})

test.describe('mon abonnement', () => {
  test('montre le palier, ce qu’il permet et ce qui en est consommé', async ({ page }) => {
    await seConnecter(page)
    await page.goto('/app/abonnement')
    await waitForHydration(page)

    await expect(page.getByTestId('palier-courant')).toContainText('Gratuit')
    await expect(page.getByTestId('consommation-tontines')).toContainText('0')
    await expect(page.getByTestId('consommation-tontines')).toContainText('sur 1')

    // Cinquième état : on ne préside encore aucune tontine.
    await expect(page.getByTestId('aucune-tontine')).toBeVisible()
  })

  test('une demande de passage s’enregistre et se voit', async ({ page }) => {
    await seConnecter(page)
    await page.goto('/app/abonnement')
    await waitForHydration(page)

    await expect(page.getByTestId('proposition-standard')).toContainText(MENSUEL_STANDARD)
    await page.getByTestId('demander-standard').click()

    await expect(page.getByTestId('demande-enregistree')).toBeVisible()

    // Une demande en cours remplace le choix : on attend une décision, on ne
    // redemande pas. Et rien n'est encaissé — le palier reste le gratuit.
    await expect(page.getByTestId('demande-en-cours')).toBeVisible()
    await expect(page.getByTestId('changer-de-palier')).toHaveCount(0)
    await expect(page.getByTestId('palier-courant')).toContainText('Gratuit')
  })

  test('n’annonce aucun encaissement dans l’application', async ({ page }) => {
    await seConnecter(page)
    await page.goto('/app/abonnement')
    await waitForHydration(page)

    // Vocabulaire interdit par la règle 8, et promesse que le produit ne tient
    // pas : il n'y a ni paiement en ligne ni prélèvement.
    const texte = await page.locator('main').innerText()
    expect(texte).not.toMatch(/encaiss|crédit|débit|solde|portefeuille|prélèvement automatique/i)
  })
})
