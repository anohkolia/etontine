import { getRouterParam } from 'h3'
import { useDb } from '../../../../db/index.ts'
import { publier } from '../../../../services/tontines.ts'
import { requireKyc, requireMembership } from '../../../../utils/auth.ts'
import { apiError } from '../../../../utils/errors.ts'

/**
 * `draft → open`. Vérifie qu'un canal de collecte vérifié est rattaché.
 *
 * C'est **ici** que le palier KYC 2 est exigé : publier, c'est exposer une
 * tontine à d'autres personnes et devenir le numéro vers lequel elles
 * enverront de l'argent. Le brouillon, lui, n'engage personne.
 */
export default defineEventHandler(async (event) => {
  const tontineId = getRouterParam(event, 'id')
  if (!tontineId) throw apiError('NOT_FOUND', 'Tontine introuvable.')

  const { user } = await requireMembership(event, tontineId, ['president'])
  requireKyc(user, 2)

  publier(useDb(), tontineId)

  return { id: tontineId, status: 'open' as const }
})
