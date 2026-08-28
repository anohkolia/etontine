import { readBody } from 'h3'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { useDb } from '../../../db/index.ts'
import { users } from '../../../db/schema.ts'
import { requireUser } from '../../../utils/auth.ts'
import { apiError, validationError } from '../../../utils/errors.ts'
import { hashPin, verifyPin } from '../../../utils/pin.ts'

/**
 * Définit ou change le code de verrouillage.
 *
 * Le PIN ne protège pas le compte — la session, elle, tient au cookie. Il
 * protège l'écran : les téléphones se prêtent, et personne n'a envie que le
 * neveu qui emprunte l'appareil lise le registre de la tontine.
 */
const pinInput = z.object({
  pin: z.string().regex(/^\d{4,6}$/, 'Le code doit contenir 4 à 6 chiffres'),
  /** Obligatoire pour remplacer un code existant. */
  currentPin: z.string().regex(/^\d{4,6}$/).optional(),
})

export default defineEventHandler(async (event) => {
  const user = requireUser(event)
  const parsed = pinInput.safeParse(await readBody(event))
  if (!parsed.success) throw validationError(parsed.error)

  if (user.pinHash) {
    if (!parsed.data.currentPin || !verifyPin(parsed.data.currentPin, user.pinHash)) {
      throw apiError('FORBIDDEN', 'Code actuel incorrect.', { field: 'currentPin' })
    }
  }

  useDb().update(users)
    .set({ pinHash: hashPin(parsed.data.pin) })
    .where(eq(users.id, user.id))
    .run()

  return { ok: true }
})
