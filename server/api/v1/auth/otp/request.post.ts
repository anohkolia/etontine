import { readBody } from 'h3'
import { otpRequestInput } from '../../../../../shared/schemas/index.ts'
import { useDb } from '../../../../db/index.ts'
import { requestOtp } from '../../../../services/otp.ts'
import { validationError } from '../../../../utils/errors.ts'

/**
 * Demande d'un code par SMS.
 *
 * Renvoie **toujours** la même chose, que le numéro soit inscrit ou non
 * (docs/api-contract.md) : une réponse différenciée ferait de ce point d'entrée
 * un annuaire des membres.
 */
export default defineEventHandler(async (event) => {
  const parsed = otpRequestInput.safeParse(await readBody(event))
  if (!parsed.success) throw validationError(parsed.error)

  return requestOtp(useDb(), parsed.data.phone, 'sms')
})
