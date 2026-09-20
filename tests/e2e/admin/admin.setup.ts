import { expect, test as setup } from '@playwright/test'
import { eq } from 'drizzle-orm'
import { creerComptesAdministrateurs } from '../../../server/db/admin-bootstrap.ts'
import { useDb } from '../../../server/db/index.ts'
import { emailTokens, users } from '../../../server/db/schema.ts'
import { CODE_TEST, emailDeTest } from '../helpers/session'

/**
 * Projet de préparation du back-office.
 *
 * Deux raisons de faire cela une seule fois, et pas dans chaque test :
 *
 * 1. **L'amorçage.** Le back-office ne crée aucun compte : la ligne de
 *    l'administrateur doit exister avant sa première connexion. C'est le même
 *    geste qu'en production, `pnpm db:admin` — puis l'administrateur s'inscrit
 *    comme tout le monde sur l'application des membres, ce qui donne à sa
 *    ligne un e-mail et un code.
 * 2. **La limitation de débit.** Les envois d'e-mail sont plafonnés à trois
 *    par dix minutes et par compte — une garde qu'on veut surtout ne pas
 *    désactiver pour les tests. On se connecte donc une fois, et l'on réutilise
 *    la session.
 */
const ETAT_SESSION = 'tests/e2e/admin/.session-admin.json'
const APP_MEMBRE = 'http://localhost:3000'

setup('prépare la session d’administration', async ({ page, baseURL }) => {
  // `NUXT_ADMIN_PHONES` est transmis au serveur par `playwright.config.ts` ;
  // le processus de test le lit ici pour viser le même numéro.
  process.env.NUXT_ADMIN_PHONES ??= '+2250500000001'
  await creerComptesAdministrateurs()

  const numero = '0500000001'
  const e164 = '+2250500000001'

  // On remet le compte dans l'état « jamais confirmé » laissé par `db:admin`,
  // et l'on efface les liens des exécutions précédentes : la limitation reste
  // active côté serveur, on nettoie seulement ce que les tests ont produit.
  const db = useDb()
  const [admin] = await db.select({ id: users.id }).from(users).where(eq(users.phone, e164))
  expect(admin, 'le compte administrateur n’a pas été amorcé').toBeTruthy()
  await db.delete(emailTokens).where(eq(emailTokens.userId, admin!.id))
  await db.update(users)
    .set({ email: null, emailVerifiedAt: null, pinHash: null, failedLogins: 0, lockedUntil: null })
    .where(eq(users.id, admin!.id))

  // L'inscription reprend la ligne amorcée : e-mail, code, lien de confirmation.
  const inscription = await page.request.post(`${APP_MEMBRE}/api/v1/auth/register`, {
    data: { phone: numero, email: emailDeTest(numero), code: CODE_TEST },
  })
  expect(inscription.ok(), `inscription refusée : ${await inscription.text()}`).toBe(true)
  const { devToken } = await inscription.json() as { devToken?: string }
  expect(devToken, 'aucun lien renvoyé — le serveur tourne-t-il hors production ?').toBeTruthy()

  const confirmation = await page.request.post(`${APP_MEMBRE}/api/v1/auth/confirm`, { data: { token: devToken } })
  expect(confirmation.ok(), `confirmation refusée : ${await confirmation.text()}`).toBe(true)

  const connexion = await page.request.post(`${baseURL}/api/auth/login`, {
    data: { phone: numero, code: CODE_TEST },
  })
  expect(connexion.ok(), `connexion refusée : ${await connexion.text()}`).toBe(true)

  await page.context().storageState({ path: ETAT_SESSION })
})
