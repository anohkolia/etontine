import { getRouterParam } from 'h3'
import { useDb } from '../../../../../../db/index.ts'
import { retirerMembre } from '../../../../../../services/membres.ts'
import { requireMembership } from '../../../../../../utils/auth.ts'
import { apiError } from '../../../../../../utils/errors.ts'

/** Sortie d'un membre. La transition d'état est contrôlée par la table. */
export default defineEventHandler(async (event) => {
  const tontineId = getRouterParam(event, 'id')
  const membershipId = getRouterParam(event, 'mid')
  if (!tontineId || !membershipId) throw apiError('NOT_FOUND', 'Membre introuvable.')

  await requireMembership(event, tontineId, ['president'])
  retirerMembre(useDb(), membershipId)

  return { ok: true }
})
