import { getRouterParam } from 'h3'
import { useDb } from '../../../../../../db/index.ts'
import { retirerMembre } from '../../../../../../services/membres.ts'
import { requireMembership } from '../../../../../../utils/auth.ts'
import { apiError } from '../../../../../../utils/errors.ts'

/**
 * Sortie d'un membre. La transition d'état est contrôlée par la table.
 *
 * Renvoie ce qu'il devait encore au moment du départ — le contrat l'annonçait,
 * et c'est le chiffre que le groupe cherchera au tour suivant.
 */
export default defineEventHandler(async (event) => {
  const tontineId = getRouterParam(event, 'id')
  const membershipId = getRouterParam(event, 'mid')
  if (!tontineId || !membershipId) throw apiError('NOT_FOUND', 'Membre introuvable.')

  const { user } = await requireMembership(event, tontineId, ['president'])
  return retirerMembre(useDb(), membershipId, user.id)
})
