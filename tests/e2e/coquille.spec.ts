import { expect, test } from '@playwright/test'
import { waitForHydration } from './helpers/hydration'
import { seConnecter } from './helpers/session'
import { inscriptionOtp } from './helpers/tontine'

/**
 * La coquille de l'application : ce qui entoure les écrans métier et qui,
 * absent, rend l'application inutilisable en production — le verrou d'écran,
 * la session expirée, la page d'erreur, l'écran de connexion qu'on ne devrait
 * plus voir une fois connecté.
 */

test('le code de verrouillage est demandé à l’ouverture, et une connexion SMS le lève', async ({ page, context }) => {
  // Le scénario attend la fenêtre de renvoi d'un code SMS : il est plus long.
  test.setTimeout(120_000)
  const numero = await inscriptionOtp(page)
  const premierCode = Date.now()

  // Pose un code depuis le profil.
  await page.goto('/app/profil')
  await waitForHydration(page)
  await page.getByTestId('champ-pin').fill('2468')
  await page.getByTestId('bouton-pin').click()
  await expect(page.getByTestId('message-pin')).toContainText('enregistré')

  // Dans le même onglet, rien n'est redemandé : on vient de le poser.
  await page.goto('/app')
  await waitForHydration(page)
  await expect(page).toHaveURL(/\/app$/)

  // Un nouvel onglet — même session, même téléphone prêté — est verrouillé.
  const autre = await context.newPage()
  await autre.goto('/app/notifications')
  await autre.waitForURL(/\/app\/verrou/)
  await waitForHydration(autre)
  expect(autre.url()).toContain('redirect=')

  // Un mauvais code dit combien d'essais restent ; le bon ouvre là où on allait.
  await autre.getByTestId('champ-code-verrou').fill('0000')
  await autre.getByTestId('bouton-deverrouiller').click()
  await expect(autre.getByTestId('erreur-verrou')).toContainText('essais')

  await autre.getByTestId('champ-code-verrou').fill('2468')
  await autre.getByTestId('bouton-deverrouiller').click()
  await autre.waitForURL(/\/app\/notifications/)

  // Code oublié : la reconnexion par SMS déverrouille, et permet le retrait
  // sans l'ancien code dans les dix minutes.
  const troisieme = await context.newPage()
  await troisieme.goto('/app')
  await troisieme.waitForURL(/\/app\/verrou/)
  await waitForHydration(troisieme)
  await troisieme.getByTestId('bouton-code-oublie').click()
  await troisieme.getByTestId('bouton-reconnexion-sms').click()
  await troisieme.waitForURL(/\/login/)

  // Un second code sur le même numéro n'est servi qu'après trente secondes :
  // la garde reste en place, le test s'y plie.
  await troisieme.waitForTimeout(Math.max(0, 31_000 - (Date.now() - premierCode)))
  await inscriptionOtp(troisieme, numero)
  await troisieme.goto('/app/profil')
  await waitForHydration(troisieme)
  await expect(troisieme).toHaveURL(/\/app\/profil/)
  await troisieme.getByTestId('bouton-pin-oublie').click()
  await expect(troisieme.getByTestId('message-pin')).toContainText('retiré')

  await autre.close()
  await troisieme.close()
})

test('une session expirée renvoie à la connexion en gardant l’intention', async ({ page }) => {
  await seConnecter(page)
  await page.goto('/app/profil/canaux')
  await waitForHydration(page)

  // La session est coupée côté serveur — déconnexion depuis un autre appareil,
  // ou expiration. L'onglet, lui, n'en sait rien.
  await page.request.post('/api/v1/auth/logout')

  // Le prochain appel à l'API — n'importe lequel, depuis la page — est un 401 :
  // on est renvoyé à la connexion, avec la page d'origine et la raison.
  await page.evaluate(() => fetch('/api/v1/me/notifications?limit=1').catch(() => null))

  await page.waitForURL(/\/login/)
  await waitForHydration(page)
  expect(page.url()).toContain('redirect=/app/profil/canaux')
  await expect(page.getByTestId('session-expiree')).toContainText('expiré')
})

test('déjà connecté, l’écran de connexion renvoie dans l’application', async ({ page }) => {
  await seConnecter(page)
  await page.goto('/login')
  await page.waitForURL(/\/app$/)
})

test('une adresse qui n’existe pas tombe sur une page en français, avec une sortie', async ({ page }) => {
  await page.goto('/cette-page-n-existe-pas')
  await waitForHydration(page)
  await expect(page.getByTestId('titre-erreur')).toContainText('n’existe pas')

  await page.getByTestId('bouton-retour-accueil').click()
  await page.waitForURL(url => url.pathname === '/')
})
