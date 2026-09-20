import { expect, test } from '@playwright/test'
import { waitForHydration } from './helpers/hydration'
import { seConnecter } from './helpers/session'
import { numeroDeTest } from './helpers/telephone'
import { inscription, tontinePubliee } from './helpers/tontine'

/**
 * La validation côté client, par les schémas partagés avec le serveur.
 *
 * Avant : on envoyait, le serveur refusait en `422`, et l'écran affichait le
 * message en bas — sans dire quel champ, après un aller-retour. Ici, l'erreur
 * est sous le champ, avant l'envoi, avec la règle que le serveur appliquera.
 */

test('la connexion refuse un numéro qui n’est pas ivoirien, sous le champ, sans appel', async ({ page }) => {
  await page.goto('/login')
  await waitForHydration(page)

  const demandes: string[] = []
  page.on('request', (r) => {
    if (r.url().includes('/api/v1/auth/login')) demandes.push(r.url())
  })

  // Dix chiffres, mais un préfixe qui n'existe pas.
  await page.getByTestId('champ-telephone').fill('12 34 56 78 90')
  await page.getByTestId('champ-telephone').blur()
  await expect(page.getByTestId('erreur-champ')).toContainText('01, 05 ou 07')

  await page.getByTestId('champ-code').fill('2604')
  await page.getByTestId('bouton-connexion').click()
  expect(demandes).toHaveLength(0)

  // Corrigé, l'erreur disparaît et la demande part.
  await page.getByTestId('champ-telephone').fill(numeroDeTest())
  await page.getByTestId('champ-telephone').blur()
  await expect(page.getByTestId('erreur-champ')).toHaveCount(0)
  await page.getByTestId('bouton-connexion').click()
  await expect(page.getByTestId('erreur-login')).toBeVisible()
  expect(demandes).toHaveLength(1)
})

test('le profil signale un prénom trop court avant d’enregistrer', async ({ page }) => {
  await seConnecter(page)
  await page.goto('/app/profil')
  await waitForHydration(page)

  await page.getByTestId('champ-prenom').fill('A')
  await page.getByTestId('champ-nom').fill('Koné')
  await page.getByTestId('bouton-enregistrer-profil').click()

  await expect(page.getByTestId('erreur-champ').first()).toBeVisible()
  await expect(page.getByTestId('profil-enregistre')).toHaveCount(0)

  await page.getByTestId('champ-prenom').fill('Aya')
  await page.getByTestId('bouton-enregistrer-profil').click()
  await expect(page.getByTestId('profil-enregistre')).toBeVisible()
})

test('l’ajout d’un membre refuse un numéro invalide sous le champ', async ({ page }) => {
  await inscription(page)
  const { id } = await tontinePubliee(page, [
    { nom: 'Koffi N’Guessan', numero: numeroDeTest() },
    { nom: 'Fatou Diarra', numero: numeroDeTest() },
  ])

  await page.goto(`/app/tontine/${id}/membres`)
  await waitForHydration(page)
  await page.getByTestId('champ-nom-membre').fill('Mariam Touré')
  await page.getByTestId('champ-numero-membre').fill('1234567890')
  await page.getByTestId('bouton-ajouter-membre').click()

  await expect(page.getByTestId('erreur-champ').first()).toContainText('01, 05 ou 07')
  // Rien n'est parti : la liste n'a pas bougé.
  await expect(page.getByTestId('liste-membres')).not.toContainText('Mariam')

  await page.getByTestId('champ-numero-membre').fill(numeroDeTest())
  await page.getByTestId('bouton-ajouter-membre').click()
  await expect(page.getByTestId('liste-membres')).toContainText('Mariam Touré')
})
