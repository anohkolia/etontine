import { readBody } from 'h3'
import { otpRequestInput } from '../../../../../shared/schemas/index.ts'
import { useDb } from '../../../../db/index.ts'
import { ECHECS_AVANT_VOCAL, failedAttempts, requestOtp } from '../../../../services/otp.ts'
import { apiError, validationError } from '../../../../utils/errors.ts'

/**
 * Repli par appel vocal, après deux échecs de saisie.
 *
 * Le SMS n'arrive pas toujours : réseau saturé, numéro porté, téléphone qui
 * filtre. L'appel vocal dicte le code. Il n'est pas offert d'emblée — il coûte
 * plus cher et sert de recours, pas de canal par défaut.
 */
export default defineEventHandler(async (event) => {
  const parsed = otpRequestInput.safeParse(await readBody(event))
  if (!parsed.success) throw validationError(parsed.error)

  const db = useDb()
  if (failedAttempts(db, parsed.data.phone) < ECHECS_AVANT_VOCAL) {
    throw apiError(
      'FORBIDDEN',
      'L’appel vocal est proposé après deux essais infructueux.',
    )
  }

  return requestOtp(db, parsed.data.phone, 'voice')
})
