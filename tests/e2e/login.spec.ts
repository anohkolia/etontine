import { expect, test } from '@playwright/test'
import { waitForHydration } from './helpers/hydration'
import { numeroDeTest, numeroFormate } from './helpers/telephone'
import { CODE_TEST, emailDeTest, inscrireParApi } from './helpers/session'

/**
 * Inscription par e-mail et connexion par numéro et code (T07, revu).
 *
 * Le parcours complet — s'inscrire, ouvrir le lien, se connecter — est ici ;
 * le masque de saisie et le cookie de session aussi. Le verrouillage du
 * compte est éprouvé en unitaire, où l'horloge est maîtrisée ; on vérifie
 * seulement ici que l'écran affiche le refus.
 */

test('le numéro s’affiche au masque XX XX XX XX XX', async ({ page }) => {
  await page.goto('/login')
  await waitForHydration(page)
  const champ = page.getByTestId('champ-telephone')
  await champ.fill('0707123456')

  // Les numéros se dictent par paires en Côte d'Ivoire : groupés, ils se
  // relisent d'un coup d'œil, ce qui réduit les erreurs de saisie.
  await expect(champ).toHaveValue('07 07 12 34 56')
})

test('le masque tolère un indicatif et les séparateurs', async ({ page }) => {
  await page.goto('/login')
  await waitForHydration(page)
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

test('le bouton reste inactif tant que le numéro ou le code est incomplet', async ({ page }) => {
  await page.goto('/login')
  await waitForHydration(page)
  const bouton = page.getByTestId('bouton-connexion')
  await expect(bouton).toBeDisabled()

  await page.getByTestId('champ-telephone').fill('0707123456')
  await expect(bouton).toBeDisabled()

  await page.getByTestId('champ-code').fill('260')
  await expect(bouton).toBeDisabled()

  await page.getByTestId('champ-code').fill('2604')
  await expect(bouton).toBeEnabled()
})

test('inscription : le lien reçu confirme le compte et ouvre la session', async ({ page }) => {
  const numero = numeroDeTest()
  await page.goto('/inscription')
  await waitForHydration(page)

  await page.getByTestId('champ-telephone').fill(numero)
  await page.getByTestId('champ-email').fill(emailDeTest(numero))
  await page.getByTestId('champ-code').fill(CODE_TEST)
  await page.getByTestId('champ-confirmation').fill(CODE_TEST)
  await page.getByTestId('bouton-inscription').click()

  // L'écran ne dit pas si le numéro était pris : « vérifie ta boîte mail », toujours.
  await expect(page.getByTestId('inscription-envoyee')).toBeVisible()

  // Hors production, le lien est affiché à l'écran plutôt qu'envoyé par e-mail.
  await page.getByTestId('lien-dev-confirmer').click()
  await page.waitForURL(/\/app/)

  // Le cookie de session est httpOnly : invisible au JavaScript, c'est le but.
  const cookies = await page.context().cookies()
  const session = cookies.find(c => c.name === 'tontine_session')
  expect(session?.httpOnly).toBe(true)
  expect(session?.sameSite).toBe('Lax')
})

test('inscription : un code trop simple ou deux codes différents bloquent avant l’envoi', async ({ page }) => {
  await page.goto('/inscription')
  await waitForHydration(page)

  await page.getByTestId('champ-telephone').fill(numeroDeTest())
  await page.getByTestId('champ-email').fill('aya@exemple.ci')

  await page.getByTestId('champ-code').fill('1234')
  await page.getByTestId('champ-confirmation').fill('1234')
  // La règle s'affiche sous le champ à la perte de focus.
  await page.getByTestId('champ-code').blur()
  await expect(page.getByTestId('erreur-champ').first()).toContainText('deviner')

  await page.getByTestId('champ-code').fill('2604')
  await page.getByTestId('champ-confirmation').fill('2605')
  await expect(page.getByTestId('bouton-inscription')).toBeDisabled()
  await expect(page.getByText('ne sont pas identiques')).toBeVisible()
})

test('un compte non confirmé ne peut pas se connecter, et le refus ne dit pas pourquoi', async ({ page }) => {
  const numero = numeroDeTest()
  const inscription = await page.request.post('/api/v1/auth/register', {
    data: { phone: numero, email: emailDeTest(numero), code: CODE_TEST },
  })
  expect(inscription.ok()).toBe(true)

  await page.goto('/login')
  await waitForHydration(page)
  await page.getByTestId('champ-telephone').fill(numero)
  await page.getByTestId('champ-code').fill(CODE_TEST)
  await page.getByTestId('bouton-connexion').click()

  // Même message qu'un numéro inconnu ou un mauvais code : l'écran de
  // connexion n'est pas un annuaire.
  await expect(page.getByTestId('erreur-login')).toContainText('Numéro ou code incorrect')
})

test('connexion : le bon code ouvre, le mauvais est refusé', async ({ page }) => {
  const numero = numeroDeTest()
  await inscrireParApi(page, numero)

  await page.goto('/login')
  await waitForHydration(page)
  await page.getByTestId('champ-telephone').fill(numero)
  await page.getByTestId('champ-code').fill('9999')
  await page.getByTestId('bouton-connexion').click()
  await expect(page.getByTestId('erreur-login')).toContainText('Numéro ou code incorrect')

  // Le champ est vidé après un refus : on ne laisse pas un code faux affiché.
  await expect(page.getByTestId('champ-code')).toHaveValue('')

  await page.getByTestId('champ-code').fill(CODE_TEST)
  await page.getByTestId('bouton-connexion').click()
  await page.waitForURL(/\/app/)
})

test('cinq échecs bloquent, et l’écran le dit', async ({ page }) => {
  const numero = numeroDeTest()
  await inscrireParApi(page, numero)

  await page.goto('/login')
  await waitForHydration(page)
  await page.getByTestId('champ-telephone').fill(numero)

  for (let i = 0; i < 4; i++) {
    await page.getByTestId('champ-code').fill('9999')
    await page.getByTestId('bouton-connexion').click()
    await expect(page.getByTestId('erreur-login')).toContainText('incorrect')
  }
  await page.getByTestId('champ-code').fill('9999')
  await page.getByTestId('bouton-connexion').click()
  await expect(page.getByTestId('erreur-login')).toContainText('Réessaie dans')

  // Le bon code ne passe plus pendant le blocage.
  await page.getByTestId('champ-code').fill(CODE_TEST)
  await page.getByTestId('bouton-connexion').click()
  await expect(page.getByTestId('erreur-login')).toContainText('Réessaie dans')
})

test('code oublié : le lien reçu pose un nouveau code et ouvre la session', async ({ page }) => {
  const numero = numeroDeTest()
  await inscrireParApi(page, numero)

  await page.goto('/login')
  await waitForHydration(page)
  await page.getByTestId('lien-code-oublie').click()
  await page.waitForURL(/\/code-oublie/)
  await waitForHydration(page)

  await page.getByTestId('champ-telephone').fill(numero)
  await page.getByTestId('bouton-envoyer-lien').click()
  await expect(page.getByTestId('lien-envoye')).toBeVisible()

  await page.getByTestId('lien-dev-reinitialiser').click()
  await page.waitForURL(/\/reinitialiser/)
  await waitForHydration(page)

  await page.getByTestId('champ-code').fill('7391')
  await page.getByTestId('champ-confirmation').fill('7391')
  await page.getByTestId('bouton-enregistrer-code').click()
  await page.waitForURL(/\/app/)

  // L'ancien code ne vaut plus rien, le nouveau ouvre.
  await page.request.post('/api/v1/auth/logout')
  await page.goto('/login')
  await waitForHydration(page)
  await page.getByTestId('champ-telephone').fill(numero)
  await page.getByTestId('champ-code').fill(CODE_TEST)
  await page.getByTestId('bouton-connexion').click()
  await expect(page.getByTestId('erreur-login')).toContainText('incorrect')

  await page.getByTestId('champ-code').fill('7391')
  await page.getByTestId('bouton-connexion').click()
  await page.waitForURL(/\/app/)
})

test('code oublié : un numéro inconnu reçoit la même réponse', async ({ page }) => {
  await page.goto('/code-oublie')
  await waitForHydration(page)
  await page.getByTestId('champ-telephone').fill(numeroDeTest())
  await page.getByTestId('bouton-envoyer-lien').click()

  // « Si un compte existe… » — rien de plus, et pas de lien de développement
  // puisqu'aucun n'a été émis.
  await expect(page.getByTestId('lien-envoye')).toBeVisible()
  await expect(page.getByTestId('lien-dev')).toHaveCount(0)
})

test('un lien de confirmation mort le dit, sans planter', async ({ page }) => {
  await page.goto(`/confirmer?token=${'A'.repeat(43)}`)
  await waitForHydration(page)
  await expect(page.getByTestId('lien-invalide')).toBeVisible()
  await expect(page.getByTestId('lien-connexion')).toBeVisible()
})

test('hors ligne, la connexion ne promet pas de garder la saisie', async ({ page, context }) => {
  await page.goto('/login')
  await waitForHydration(page)
  await context.setOffline(true)

  // Rien n'est mis en file ici : un code d'accès ne se vérifie pas sans
  // réseau. Le bandeau générique annonçait pourtant que la saisie partirait
  // toute seule — le membre attendait une ouverture qui n'avait jamais eu lieu.
  const bandeau = page.getByTestId('offline-banner')
  await expect(bandeau).toBeVisible()
  await expect(bandeau).toContainText('a besoin du réseau')
  await expect(bandeau).not.toContainText('Ce que tu saisis')
})
