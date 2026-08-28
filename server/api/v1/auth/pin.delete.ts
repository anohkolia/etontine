import { readBody } from 'h3'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { useDb } from '../../../db/index.ts'
import { users } from '../../../db/schema.ts'
import { requireUser } from '../../../utils/auth.ts'
import { apiError, validationError } from '../../../utils/errors.ts'
import { verifyPin } from '../../../utils/pin.ts'

/** Retire le verrouillage. Exige le code courant : sinon n'importe qui l'ôte. */
export default defineEventHandler(async (event) => {
  const user = requireUser(event)
  const parsed = z.object({ currentPin: z.string() }).safeParse(await readBody(event))
  if (!parsed.success) throw validationError(parsed.error)

  if (!user.pinHash || !verifyPin(parsed.data.currentPin, user.pinHash)) {
    throw apiError('FORBIDDEN', 'Code actuel incorrect.', { field: 'currentPin' })
  }

  useDb().update(users).set({ pinHash: null }).where(eq(users.id, user.id)).run()
  return { ok: true }
})
