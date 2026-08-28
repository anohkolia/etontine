import { getRouterParam, readBody } from 'h3'
import { managedMemberInput } from '../../../../../../shared/schemas/index.ts'
import { useDb } from '../../../../../db/index.ts'
import { ajouterMembreGere } from '../../../../../services/membres.ts'
import { requireMembership } from '../../../../../utils/auth.ts'
import { apiError, validationError } from '../../../../../utils/errors.ts'

/** Ajoute un membre géré — quelqu'un qui n'a pas encore l'application. */
export default defineEventHandler(async (event) => {
  const tontineId = getRouterParam(event, 'id')
  if (!tontineId) throw apiError('NOT_FOUND', 'Tontine introuvable.')

  await requireMembership(event, tontineId, ['president'])

  const parsed = managedMemberInput.safeParse(await readBody(event))
  if (!parsed.success) throw validationError(parsed.error)

  const id = ajouterMembreGere(useDb(), tontineId, parsed.data)
  return { id, shares: parsed.data.shares }
})
