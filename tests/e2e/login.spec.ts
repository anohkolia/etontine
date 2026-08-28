import { expect, test } from '@playwright/test'
import { waitForHydration } from './helpers/hydration'
import { numeroDeTest, numeroFormate } from './helpers/telephone'
import { remplirCode } from './helpers/otp'

/**
 * Écran de connexion (T07). Le parcours complet d'inscription est repris en
 * T26 ; ici on vérifie ce que le ticket exige explicitement : le masque de
 * saisie, `autocomplete="one-time-code"`, et le compte à rebours de renvoi.
 */
test.beforeEach(async ({ page }) => {
  await page.goto('/login')
  await waitForHydration(page)
})

test('le numéro s’affiche au masque XX XX XX XX XX', async ({ page }) => {
  const champ = page.getByTestId('champ-telephone')
  await champ.fill('0707123456')

  // Les numéros se dictent par paires en Côte d'Ivoire : groupés, ils se
  // relisent d'un coup d'œil, ce qui réduit les erreurs de saisie.
  await expect(champ).toHaveValue('07 07 12 34 56')
})

test('le masque tolère un indicatif et les séparateurs', async ({ page }) => {
  const champ = page.getByTestId('champ-telephone')
  const attendu = numeroFormate('0707123456')

  await champ.fill('+225 07 07 12 34 56')
  await expect(champ).toHaveValue(attendu)

  // Deux saisies différentes donnent le même numéro normalisé : sans repose
  // explicite de la valeur, Vue ne repeindrait pas le champ et la seconde
  // saisie resterait affichée telle quelle.
  await champ.fill('07.07.12.34.56')
  await expect(champ).toHaveValue(attendu)
})

test('le bouton reste inactif tant que le numéro est incomplet', async ({ page }) => {
  const bouton = page.getByTestId('bouton-recevoir-code')
  await expect(bouton).toBeDisabled()

  await page.getByTestId('champ-telephone').fill('070712345')
  await expect(bouton).toBeDisabled()

  await page.getByTestId('champ-telephone').fill('0707123456')
  await expect(bouton).toBeEnabled()
})

test('le champ de code porte autocomplete="one-time-code"', async ({ page }) => {
  await page.getByTestId('champ-telephone').fill(numeroDeTest())
  await page.getByTestId('bouton-recevoir-code').click()

  const cases = page.locator('[data-testid="champ-code"] input')
  await expect(cases.first()).toBeVisible()

  // Sans cet attribut, Android et iOS ne proposent pas le code reçu : le membre
  // doit quitter l'application pour le recopier, et perd sa saisie.
  await expect(cases.first()).toHaveAttribute('autocomplete', 'one-time-code')
  await expect(cases).toHaveCount(6)
})

test('le renvoi est bloqué pendant 30 secondes', async ({ page }) => {
  await page.getByTestId('champ-telephone').fill(numeroDeTest())
  await page.getByTestId('bouton-recevoir-code').click()

  const renvoi = page.getByTestId('bouton-renvoyer')
  await expect(renvoi).toBeDisabled()
  await expect(renvoi).toContainText('Renvoyer le code dans')
})

test('l’appel vocal n’apparaît qu’après deux échecs', async ({ page }) => {
  await page.getByTestId('champ-telephone').fill(numeroDeTest())
  await page.getByTestId('bouton-recevoir-code').click()

  // L'appel coûte plus cher : c'est un recours, pas le canal par défaut.
  await expect(page.getByTestId('bouton-vocal')).toBeHidden()

  for (let i = 0; i < 2; i++) {
    await remplirCode(page, 'champ-code', '000000')
    await page.getByTestId('bouton-valider-code').click()
    await expect(page.getByTestId('erreur-login')).toBeVisible()
  }

  await expect(page.getByTestId('bouton-vocal')).toBeVisible()
})

test('un code valide ouvre la session et mène à l’application', async ({ page }) => {
  await page.getByTestId('champ-telephone').fill(numeroDeTest())
  await page.getByTestId('bouton-recevoir-code').click()

  // En développement, le code est affiché à l'écran plutôt qu'envoyé par SMS.
  const encart = page.getByTestId('code-dev')
  await expect(encart).toBeVisible()
  const code = (await encart.textContent())?.match(/\d{6}/)?.[0]
  expect(code).toMatch(/^\d{6}$/)

  await remplirCode(page, 'champ-code', code!)
  await page.getByTestId('bouton-valider-code').click()

  await page.waitForURL(/\/app/)
  // Le cookie de session est httpOnly : invisible au JavaScript, c'est le but.
  const cookies = await page.context().cookies()
  const session = cookies.find(c => c.name === 'tontine_session')
  expect(session?.httpOnly).toBe(true)
  expect(session?.sameSite).toBe('Lax')
})
