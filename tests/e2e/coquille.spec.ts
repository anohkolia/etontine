import { expect, test } from '@playwright/test'
import { waitForHydration } from './helpers/hydration'
import { CODE_TEST, seConnecter } from './helpers/session'
import { inscription } from './helpers/tontine'

/**
 * La coquille de l'application : ce qui entoure les écrans métier et qui,
 * absent, rend l'application inutilisable en production — le verrou d'écran,
 * la session expirée, la page d'erreur, l'écran de connexion qu'on ne devrait
 * plus voir une fois connecté.
 */

test('le code d’accès est demandé à l’ouverture d’un nouvel onglet, et « code oublié » mène à l’e-mail', async ({ page, context }) => {
  await inscription(page)

  // Dans l'onglet de connexion, rien n'est redemandé : le code vient d'être saisi.
  await page.goto('/app')
  await waitForHydration(page)
  await expect(page).toHaveURL(/\/app$/)

  // Un nouvel onglet — même session, même téléphone prêté — est verrouillé.
  const autre = await context.newPage()
  await autre.goto('/app/notifications')
  await autre.waitForURL(/\/app\/verrou/)
  await waitForHydration(autre)
  expect(autre.url()).toContain('redirect=')

  // Un mauvais code est refusé ; le bon ouvre là où on allait.
  await autre.getByTestId('champ-code-verrou').fill('9999')
  await autre.getByTestId('bouton-deverrouiller').click()
  await expect(autre.getByTestId('erreur-verrou')).toContainText('incorrect')

  await autre.getByTestId('champ-code-verrou').fill(CODE_TEST)
  await autre.getByTestId('bouton-deverrouiller').click()
  await autre.waitForURL(/\/app\/notifications/)

  // Code oublié : on est déconnecté et envoyé vers la réinitialisation par
  // e-mail — le seul chemin, puisque le même code ouvre la session.
  const troisieme = await context.newPage()
  await troisieme.goto('/app')
  await troisieme.waitForURL(/\/app\/verrou/)
  await waitForHydration(troisieme)
  await troisieme.getByTestId('bouton-code-oublie').click()
  await troisieme.getByTestId('bouton-reinitialiser').click()
  await troisieme.waitForURL(/\/code-oublie/)

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
