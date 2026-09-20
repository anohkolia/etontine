import { getRequestIP, readBody } from 'h3'
import { resetRequestInput } from '../../../../../shared/schemas/index.ts'
import { useDb } from '../../../../db/index.ts'
import { demanderReinitialisation, limiterParIp } from '../../../../services/connexion.ts'
import { validationError } from '../../../../utils/errors.ts'

/**
 * Code oublié : un lien part sur l'adresse du compte.
 *
 * La réponse est la même que le numéro soit connu ou non — voir
 * `demanderReinitialisation`.
 */
export default defineEventHandler(async (event) => {
  limiterParIp(getRequestIP(event, { xForwardedFor: true }))

  const parsed = resetRequestInput.safeParse(await readBody(event))
  if (!parsed.success) throw validationError(parsed.error)

  return await demanderReinitialisation(useDb(), parsed.data.phone)
})
