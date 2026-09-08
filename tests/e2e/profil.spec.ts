import { expect, test } from '@playwright/test'
import { waitForHydration } from './helpers/hydration'
import { numeroDeTest } from './helpers/telephone'
import { remplirCode } from './helpers/otp'

/** Ouvre une session neuve et atterrit dans l'application. */
async function seConnecter(page: import('@playwright/test').Page) {
  await page.goto('/login')
  await waitForHydration(page)
  await page.getByTestId('champ-telephone').fill(numeroDeTest())
  await page.getByTestId('bouton-recevoir-code').click()

  const code = (await page.getByTestId('code-dev').textContent())?.match(/\d{6}/)?.[0]
  await remplirCode(page, 'champ-code', code!)
  await page.getByTestId('bouton-valider-code').click()
  await page.waitForURL(/\/app/)
}

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

test('le code de verrouillage s’enregistre', async ({ page }) => {
  await seConnecter(page)
  await page.goto('/app/profil')
  await waitForHydration(page)

  await page.getByTestId('champ-pin').fill('1234')
  await page.getByTestId('bouton-pin').click()

  await expect(page.getByTestId('message-pin')).toContainText('enregistré')

  // Et il se retire. Un verrou qu'on ne peut pas rendre finit par enfermer
  // quelqu'un dehors — la route existait, sans aucun bouton pour l'appeler.
  await page.getByTestId('champ-pin-actuel').fill('1234')
  await page.getByTestId('bouton-retirer-pin').click()
  await expect(page.getByTestId('message-pin')).toContainText('retiré')

  // Retiré pour de bon : le champ « code actuel » disparaît avec lui.
  await expect(page.getByTestId('champ-pin-actuel')).toHaveCount(0)
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
  await page.goto('/app/profil/donnees')
  await page.waitForURL(/\/login/)
  await waitForHydration(page)

  await page.getByTestId('champ-telephone').fill(numeroDeTest())
  await page.getByTestId('bouton-recevoir-code').click()
  const code = (await page.getByTestId('code-dev').textContent())?.match(/\d{6}/)?.[0]
  await remplirCode(page, 'champ-code', code!)
  await page.getByTestId('bouton-valider-code').click()

  // Sans cela, quelqu'un qui ouvre un lien de cotisation reçu par WhatsApp
  // atterrit sur un tableau de bord générique et doit tout recommencer.
  await page.waitForURL(/\/app\/profil\/donnees/)
})
