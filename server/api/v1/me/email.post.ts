import { readBody } from 'h3'
import { emailChangeInput } from '../../../../shared/schemas/index.ts'
import { useDb } from '../../../db/index.ts'
import { demanderChangementEmail } from '../../../services/connexion.ts'
import { requireUser } from '../../../utils/auth.ts'
import { validationError } from '../../../utils/errors.ts'

/**
 * Demande à changer d'adresse e-mail : le code d'accès, puis un lien sur la
 * nouvelle adresse. Elle ne devient celle du compte qu'au clic.
 */
export default defineEventHandler(async (event) => {
  const user = requireUser(event)
  const parsed = emailChangeInput.safeParse(await readBody(event))
  if (!parsed.success) throw validationError(parsed.error)

  return await demanderChangementEmail(useDb(), user, parsed.data.email, parsed.data.code)
})
