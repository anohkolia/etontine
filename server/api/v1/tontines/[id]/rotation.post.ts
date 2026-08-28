import { getRouterParam, readBody } from 'h3'
import { rotationInput } from '../../../../../shared/schemas/index.ts'
import { useDb } from '../../../../db/index.ts'
import { definirRotation } from '../../../../services/membres.ts'
import { requireMembership } from '../../../../utils/auth.ts'
import { apiError, validationError } from '../../../../utils/errors.ts'

/**
 * Fixe l'ordre de passage.
 *
 * En mode `draw`, **le tirage est fait côté serveur** et sa graine est inscrite
 * au registre : n'importe quel membre peut la rejouer et vérifier le résultat.
 * Un tirage côté client serait invérifiable, donc contestable.
 */
export default defineEventHandler(async (event) => {
  const tontineId = getRouterParam(event, 'id')
  if (!tontineId) throw apiError('NOT_FOUND', 'Tontine introuvable.')

  const { user } = await requireMembership(event, tontineId, ['president'])

  const parsed = rotationInput.safeParse(await readBody(event))
  if (!parsed.success) throw validationError(parsed.error)

  return definirRotation(useDb(), tontineId, user.id, parsed.data)
})
