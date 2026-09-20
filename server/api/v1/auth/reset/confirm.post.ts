import { readBody } from 'h3'
import { resetConfirmInput } from '../../../../../shared/schemas/index.ts'
import { useDb } from '../../../../db/index.ts'
import { reinitialiserCode } from '../../../../services/connexion.ts'
import { createSession } from '../../../../utils/session.ts'
import { validationError } from '../../../../utils/errors.ts'

/**
 * Pose le nouveau code par le lien reçu, et ouvre la session.
 *
 * Rouvre aussi un compte verrouillé : c'est la seule porte après dix échecs.
 */
export default defineEventHandler(async (event) => {
  const parsed = resetConfirmInput.safeParse(await readBody(event))
  if (!parsed.success) throw validationError(parsed.error)

  const { userId } = await reinitialiserCode(useDb(), parsed.data.token, parsed.data.code)
  await createSession(event, userId)

  return { ok: true }
})
