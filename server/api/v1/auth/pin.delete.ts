import { getCookie, readBody } from 'h3'
import { z } from 'zod'
import { useDb } from '../../../db/index.ts'
import { requireUser } from '../../../utils/auth.ts'
import { apiError, validationError } from '../../../utils/errors.ts'
import { verifyPin } from '../../../utils/pin.ts'
import { SESSION_COOKIE } from '../../../utils/session.ts'
import { retirerCodeVerrou, sessionFraiche } from '../../../services/verrou.ts'

/**
 * Retire le verrouillage.
 *
 * Exige le code courant : sinon n'importe qui l'ôte. **Sauf** juste après une
 * connexion par SMS : quelqu'un qui a oublié son code se reconnecte, prouve
 * qu'il tient la SIM, et peut alors le retirer — sans cette porte, un code
 * oublié enfermait dehors pour de bon.
 */
export default defineEventHandler(async (event) => {
  const user = requireUser(event)
  const parsed = z.object({ currentPin: z.string().optional() }).safeParse(await readBody(event))
  if (!parsed.success) throw validationError(parsed.error)

  const db = useDb()

  if (!user.pinHash) return { ok: true }

  const parLeCode = parsed.data.currentPin !== undefined && verifyPin(parsed.data.currentPin, user.pinHash)
  const parLaSession = parsed.data.currentPin === undefined && sessionFraiche(db, getCookie(event, SESSION_COOKIE))

  if (!parLeCode && !parLaSession) {
    throw apiError('FORBIDDEN', 'Code actuel incorrect.', { field: 'currentPin' })
  }

  retirerCodeVerrou(db, user.id)
  return { ok: true }
})
