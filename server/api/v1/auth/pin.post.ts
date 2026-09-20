import { readBody } from 'h3'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { codeAcces, codeSaisi } from '../../../../shared/schemas/index.ts'
import { useDb } from '../../../db/index.ts'
import { users } from '../../../db/schema.ts'
import { requireUser } from '../../../utils/auth.ts'
import { validationError } from '../../../utils/errors.ts'
import { hashPin } from '../../../utils/pin.ts'
import { verifierCodeAcces } from '../../../services/connexion.ts'

/**
 * Change le code d'accès.
 *
 * Le code courant est exigé : la session seule ne suffit pas, sinon un
 * téléphone prêté cinq minutes permettrait de le remplacer. Il n'y a pas de
 * retrait : le code ouvre la session, un compte sans code n'ouvrirait plus.
 */
const input = z.object({
  code: codeAcces,
  currentCode: codeSaisi,
})

export default defineEventHandler(async (event) => {
  const user = requireUser(event)
  const parsed = input.safeParse(await readBody(event))
  if (!parsed.success) throw validationError(parsed.error)

  const db = useDb()
  await verifierCodeAcces(db, user, parsed.data.currentCode)

  await db.update(users)
    .set({ pinHash: hashPin(parsed.data.code) })
    .where(eq(users.id, user.id))

  return { ok: true }
})
