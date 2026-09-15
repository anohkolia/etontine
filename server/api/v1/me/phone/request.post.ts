import { readBody } from 'h3'
import { otpRequestInput } from '../../../../../shared/schemas/index.ts'
import { useDb } from '../../../../db/index.ts'
import { demanderChangementNumero } from '../../../../services/compte.ts'
import { requestOtp } from '../../../../services/otp.ts'
import { requireUser } from '../../../../utils/auth.ts'
import { validationError } from '../../../../utils/errors.ts'

/**
 * Demande un code sur le **nouveau** numéro.
 *
 * L'ancien numéro peut être perdu avec la SIM : c'est le nouveau qu'il faut
 * prouver. La limitation de débit est celle des codes de connexion.
 */
export default defineEventHandler(async (event) => {
  const user = requireUser(event)
  const parsed = otpRequestInput.safeParse(await readBody(event))
  if (!parsed.success) throw validationError(parsed.error)

  const db = useDb()
  demanderChangementNumero(db, user.id, parsed.data.phone)
  return requestOtp(db, parsed.data.phone, 'sms')
})
