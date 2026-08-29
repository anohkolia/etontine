import { expect, test as setup } from '@playwright/test'
import { eq } from 'drizzle-orm'
import { creerComptesAdministrateurs } from '../../../server/db/admin-bootstrap.ts'
import { useDb } from '../../../server/db/index.ts'
import { otpRequests } from '../../../server/db/schema.ts'

/**
 * Projet de préparation du back-office.
 *
 * Deux raisons de faire cela une seule fois, et pas dans chaque test :
 *
 * 1. **L'amorçage.** Le back-office ne crée aucun compte : la ligne de
 *    l'administrateur doit exister avant sa première connexion. C'est le même
 *    geste qu'en production, `pnpm db:admin`.
 * 2. **La limitation de débit.** Les demandes de code sont plafonnées à trois
 *    par dix minutes et par numéro — une garde qu'on veut surtout ne pas
 *    désactiver pour les tests. On se connecte donc une fois, et l'on réutilise
 *    la session.
 */
const ETAT_SESSION = 'tests/e2e/admin/.session-admin.json'

setup('prépare la session d’administration', async ({ page, baseURL }) => {
  // `NUXT_ADMIN_PHONES` est transmis au serveur par `playwright.config.ts` ;
  // le processus de test le lit ici pour viser le même numéro.
  process.env.NUXT_ADMIN_PHONES ??= '+2250500000001'
  creerComptesAdministrateurs()

  const numero = '0500000001'
  const e164 = '+2250500000001'

  // On efface les demandes de code laissées par les exécutions précédentes.
  // La limitation — trois par dix minutes et par numéro — reste active côté
  // serveur : c'est une garde de production, on ne la désactive pas. On nettoie
  // seulement l'état que les tests ont eux-mêmes produit, comme on remet une
  // base à zéro entre deux exécutions.
  useDb().delete(otpRequests).where(eq(otpRequests.phone, e164)).run()

  const demande = await page.request.post(`${baseURL}/api/auth/request`, {
    data: { phone: numero },
  })
  expect(demande.ok(), `demande de code refusée : ${await demande.text()}`).toBe(true)

  const { devCode } = await demande.json() as { devCode?: string }
  expect(devCode, 'aucun code renvoyé — le serveur tourne-t-il hors production ?').toMatch(/^\d{6}$/)

  const verification = await page.request.post(`${baseURL}/api/auth/verify`, {
    data: { phone: numero, code: devCode },
  })
  expect(verification.ok(), `connexion refusée : ${await verification.text()}`).toBe(true)

  await page.context().storageState({ path: ETAT_SESSION })
})
