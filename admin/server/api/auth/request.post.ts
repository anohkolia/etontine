import { readBody } from 'h3'
import { otpRequestInput } from '../../../../shared/schemas/index.ts'
import { useDb } from '../../../../server/db/index.ts'
import { requestOtp } from '../../../../server/services/otp.ts'
import { validationError } from '../../../../server/utils/errors.ts'

/**
 * Demande d'un code pour le back-office.
 *
 * La réponse est identique que le numéro soit administrateur ou non — comme
 * côté membre, et pour la même raison : ce point d'entrée ne doit pas révéler
 * qui a les droits d'administration. Le filtrage a lieu à la vérification.
 */
export default defineEventHandler(async (event) => {
  const parsed = otpRequestInput.safeParse(await readBody(event))
  if (!parsed.success) throw validationError(parsed.error)

  return requestOtp(useDb(), parsed.data.phone, 'sms')
})
