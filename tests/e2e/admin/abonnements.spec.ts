import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { eq } from 'drizzle-orm'
import { useDb } from '../../../server/db/index.ts'
import { users } from '../../../server/db/schema.ts'
import { waitForHydration } from '../helpers/hydration'
import { numeroDeTest } from '../helpers/telephone'
import { remplirCode } from '../helpers/otp'

/**
 * Back-office — demandes d'abonnement.
 *
 * C'est le seul endroit d'où un palier payant peut être accordé.
 * L'application n'encaisse rien : l'administrateur constate le règlement hors
 * application, puis signe ici. Ce que ces tests vérifient, c'est que la
 * signature a bien lieu — et qu'elle laisse une trace.
 */

const APP_MEMBRE = 'http://localhost:3000'

/**
 * Ces deux tests pilotent **deux applications** : une inscription par code à
 * usage unique côté membre, la décision côté back-office, puis un retour côté
 * membre pour vérifier ce qu'il en voit. Le délai par défaut y suffit à peine
 * quand les serveurs de développement compilent en parallèle — et un test qui
 * échoue par manque de temps n'apprend rien sur le produit.
 */
test.slow()

/** Un président qui a demandé le palier Standard et attend une décision. */
async function deposerUneDemande(page: Page): Promise<string> {
  const numero = numeroDeTest()

  await page.goto(`${APP_MEMBRE}/login`)
  await waitForHydration(page)
  await page.getByTestId('champ-telephone').fill(numero)
  await page.getByTestId('bouton-recevoir-code').click()

  const code = (await page.getByTestId('code-dev').textContent())?.match(/\d{6}/)?.[0]
  await remplirCode(page, 'champ-code', code!)
  await page.getByTestId('bouton-valider-code').click()
  await page.waitForURL(url => !url.pathname.startsWith('/login'))

  const reponse = await page.request.post(`${APP_MEMBRE}/api/v1/me/subscription/request`, {
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    data: { tier: 'standard', periodicity: 'monthly' },
  })
  if (!reponse.ok()) throw new Error(`demande refusée : ${await reponse.text()}`)

  return `+225${numero}`
}

test('l’administrateur approuve une demande et le palier est posé', async ({ page, browser }) => {
  const contexteMembre = await browser.newContext()
  const membre = await contexteMembre.newPage()
  const numero = await deposerUneDemande(membre)

  await page.goto('/abonnements')
  await waitForHydration(page)

  const carte = page.locator('[data-testid^="demande-"]').filter({ hasText: numero })
  await expect(carte).toHaveCount(1)
  await expect(carte).toContainText('Gratuit → Standard')
  // Le prix suit la règle 7 : espace fine insécable, zéro décimale, FCFA.
  await expect(carte).toContainText('7 500 FCFA')

  await carte.getByTestId(/^approuver-/).click()

  // La demande quitte la file en attente.
  await expect(page.locator('[data-testid^="demande-"]').filter({ hasText: numero }))
    .toHaveCount(0)

  const [compte] = useDb().select().from(users).where(eq(users.phone, numero)).all()
  expect(compte!.planTier).toBe('standard')
  expect(compte!.planUntil).not.toBeNull()

  // Vu du président : le palier est en place, et plus aucune demande n'attend.
  await membre.goto(`${APP_MEMBRE}/app/abonnement`)
  await waitForHydration(membre)
  await expect(membre.getByTestId('palier-courant')).toContainText('Standard')
  await expect(membre.getByTestId('demande-en-cours')).toHaveCount(0)

  await contexteMembre.close()
})

test('un refus sans motif est impossible, et le motif parvient au président', async ({ page, browser }) => {
  const contexteMembre = await browser.newContext()
  const membre = await contexteMembre.newPage()
  const numero = await deposerUneDemande(membre)

  await page.goto('/abonnements')
  await waitForHydration(page)

  const carte = page.locator('[data-testid^="demande-"]').filter({ hasText: numero })
  await carte.getByTestId(/^ouvrir-refus-/).click()

  // Un refus sans raison est une impasse : le bouton reste hors d'atteinte.
  await expect(carte.getByTestId(/^refuser-/)).toBeDisabled()

  await carte.getByTestId(/^motif-/).fill('Règlement non constaté à ce jour.')
  await carte.getByTestId(/^refuser-/).click()

  await expect(page.locator('[data-testid^="demande-"]').filter({ hasText: numero }))
    .toHaveCount(0)

  const [compte] = useDb().select().from(users).where(eq(users.phone, numero)).all()
  expect(compte!.planTier).toBe('free')

  await membre.goto(`${APP_MEMBRE}/app/abonnement`)
  await waitForHydration(membre)
  await expect(membre.getByTestId('derniere-decision')).toContainText('Règlement non constaté')

  await contexteMembre.close()
})
