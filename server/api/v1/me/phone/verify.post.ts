import { readBody } from 'h3'
import { otpVerifyInput } from '../../../../../shared/schemas/index.ts'
import { useDb } from '../../../../db/index.ts'
import { appliquerChangementNumero } from '../../../../services/compte.ts'
import { consommerCode } from '../../../../services/otp.ts'
import { requireUser } from '../../../../utils/auth.ts'
import { validationError } from '../../../../utils/errors.ts'

/**
 * Vérifie le code reçu sur le nouveau numéro et applique le changement.
 *
 * Pose `phone_changed_at` : les versements vers ce membre sont gelés
 * quarante-huit heures, et son bureau est prévenu.
 */
export default defineEventHandler(async (event) => {
  const user = requireUser(event)
  const parsed = otpVerifyInput.safeParse(await readBody(event))
  if (!parsed.success) throw validationError(parsed.error)

  const db = useDb()
  consommerCode(db, parsed.data.phone, parsed.data.code)
  appliquerChangementNumero(db, user.id, parsed.data.phone)
  return { ok: true, phone: parsed.data.phone }
})
