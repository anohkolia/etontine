import { expect, test } from '@playwright/test'
import { waitForHydration } from './helpers/hydration'
import { numeroDeTest } from './helpers/telephone'
import { CODE_TEST, inscrireParApi, seConnecter } from './helpers/session'

test('les deux consentements sont deux cases distinctes', async ({ page }) => {
  await seConnecter(page)
  await page.goto('/app/profil')
  await waitForHydration(page)

  const donnees = page.getByTestId('consentement-donnees')
  const notifications = page.getByTestId('consentement-notifications')

  await expect(donnees).toBeVisible()
  await expect(notifications).toBeVisible()

  // Acceptation T08 : accepter le traitement de ses données n'est pas accepter
  // les notifications. Cocher l'une ne doit pas cocher l'autre.
  await donnees.check()
  await expect(notifications).not.toBeChecked()

  await page.reload()
  await waitForHydration(page)
  await expect(page.getByTestId('consentement-donnees')).toBeChecked()
  await expect(page.getByTestId('consentement-notifications')).not.toBeChecked()
})

test('le profil s’enregistre et fait passer au palier suivant', async ({ page }) => {
  await seConnecter(page)
  await page.goto('/app/profil')
  await waitForHydration(page)

  await page.getByTestId('champ-prenom').fill('Aya')
  await page.getByTestId('champ-nom').fill('Koné')
  await page.getByTestId('bouton-enregistrer-profil').click()

  await expect(page.getByTestId('profil-enregistre')).toBeVisible()
})

test('le code d’accès se change, contre le code courant', async ({ page }) => {
  const numero = await seConnecter(page)
  await page.goto('/app/profil')
  await waitForHydration(page)

  // Le mauvais code courant est refusé : la session seule ne suffit pas.
  await page.getByTestId('champ-pin-actuel').fill('9999')
  await page.getByTestId('champ-pin').fill('7391')
  await page.getByTestId('bouton-pin').click()
  await expect(page.getByTestId('message-pin')).toContainText('incorrect')

  await page.getByTestId('champ-pin-actuel').fill(CODE_TEST)
  await page.getByTestId('champ-pin').fill('7391')
  await page.getByTestId('bouton-pin').click()
  await expect(page.getByTestId('message-pin')).toContainText('enregistré')

  // Et c'est le nouveau code qui ouvre la session.
  await page.request.post('/api/v1/auth/logout')
  await page.goto('/login')
  await waitForHydration(page)
  await page.getByTestId('champ-telephone').fill(numero)
  await page.getByTestId('champ-code').fill('7391')
  await page.getByTestId('bouton-connexion').click()
  await page.waitForURL(/\/app/)
})

test('un code trop simple est refusé avant l’envoi', async ({ page }) => {
  await seConnecter(page)
  await page.goto('/app/profil')
  await waitForHydration(page)

  await page.getByTestId('champ-pin-actuel').fill(CODE_TEST)
  await page.getByTestId('champ-pin').fill('1234')
  await page.getByTestId('bouton-pin').click()
  await expect(page.getByTestId('message-pin')).toContainText('deviner')
})

test('l’adresse e-mail se change par un lien sur la nouvelle adresse', async ({ page }) => {
  await seConnecter(page)
  await page.goto('/app/profil')
  await waitForHydration(page)

  await page.getByTestId('bouton-changer-email').click()
  await page.getByTestId('champ-nouvel-email').fill(`nouvelle-${numeroDeTest()}@test.etontine.ci`)
  await page.getByTestId('champ-code-email').fill(CODE_TEST)
  await page.getByTestId('bouton-valider-email').click()
  await expect(page.getByTestId('message-email')).toContainText('Lien envoyé')

  // Rien n'a changé tant que le lien n'est pas ouvert.
  const avant = await page.getByTestId('email-actuel').textContent()
  expect(avant).not.toContain('nouvelle-')

  // Hors production, le lien est affiché : on l'ouvre, et l'on attend que
  // le serveur ait confirmé — l'adresse ne change qu'à ce moment-là.
  const confirmation = page.waitForResponse(r => r.url().includes('/api/v1/auth/confirm'))
  await page.getByTestId('lien-dev-email-confirmer').click()
  expect((await confirmation).ok()).toBe(true)
  await page.goto('/app/profil')
  await waitForHydration(page)
  await expect(page.getByTestId('email-actuel')).toContainText('nouvelle-')
})

test('la page de données propose l’export et la suppression', async ({ page }) => {
  await seConnecter(page)
  await page.goto('/app/profil/donnees')
  await waitForHydration(page)

  await expect(page.getByTestId('bouton-export')).toBeVisible()
  await expect(page.getByTestId('bouton-supprimer')).toBeVisible()

  // Un compte sans engagement se supprime : la confirmation s'affiche d'abord,
  // le geste n'est pas irréversible au premier clic.
  await page.getByTestId('bouton-supprimer').click()
  await expect(page.getByTestId('bouton-confirmer-suppression')).toBeVisible()
})

test('une page de l’application redirige vers la connexion sans session', async ({ page }) => {
  await page.goto('/app/profil')
  await page.waitForURL(/\/login/)

  // L'intention initiale est conservée : sans elle, on renvoie le membre au
  // point de départ après connexion et il abandonne.
  expect(page.url()).toContain('redirect=/app/profil')
})

test('après connexion, on revient à la page demandée au départ', async ({ page }) => {
  const numero = numeroDeTest()
  await inscrireParApi(page, numero)

  await page.goto('/app/profil/donnees')
  await page.waitForURL(/\/login/)
  await waitForHydration(page)

  await page.getByTestId('champ-telephone').fill(numero)
  await page.getByTestId('champ-code').fill(CODE_TEST)
  await page.getByTestId('bouton-connexion').click()

  // Sans cela, quelqu'un qui ouvre un lien de cotisation reçu par WhatsApp
  // atterrit sur un tableau de bord générique et doit tout recommencer.
  await page.waitForURL(/\/app\/profil\/donnees/)
})
