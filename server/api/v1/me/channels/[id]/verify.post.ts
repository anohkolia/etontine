import { getRouterParam, readBody } from 'h3'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { otpCode } from '../../../../../../shared/schemas/index.ts'
import { useDb } from '../../../../../db/index.ts'
import { collectionChannels } from '../../../../../db/schema.ts'
import { marquerVerifie } from '../../../../../services/canaux.ts'
import { requestOtp, verifyOtp } from '../../../../../services/otp.ts'
import { requireUser } from '../../../../../utils/auth.ts'
import { apiError, validationError } from '../../../../../utils/errors.ts'

/**
 * Vérification du numéro de collecte par OTP.
 *
 * Sans corps : envoie un code sur le **numéro de collecte** (et non sur celui
 * du compte). Avec `{ code }` : valide.
 *
 * L'OTP part sur le numéro de collecte lui-même, c'est tout l'intérêt : il
 * prouve que l'organisateur contrôle ce numéro. Un contrôle sur le numéro du
 * compte ne prouverait rien — on peut déclarer le numéro de n'importe qui.
 */
export default defineEventHandler(async (event) => {
  const user = requireUser(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw apiError('NOT_FOUND', 'Canal introuvable.')

  const db = useDb()
  const [canal] = db
    .select()
    .from(collectionChannels)
    .where(and(eq(collectionChannels.id, id), eq(collectionChannels.userId, user.id)))
    .limit(1)
    .all()

  if (!canal) throw apiError('NOT_FOUND', 'Canal introuvable.')

  const corps = await readBody(event).catch(() => null)
  const parsed = z.object({ code: otpCode }).safeParse(corps ?? {})

  if (!parsed.success) {
    // Pas de code fourni : on en envoie un.
    if (corps && Object.keys(corps).length > 0) throw validationError(parsed.error)
    return requestOtp(db, canal.msisdn, 'sms')
  }

  await verifyOtp(db, canal.msisdn, parsed.data.code)
  marquerVerifie(db, id)

  return { id, verified: true }
})
