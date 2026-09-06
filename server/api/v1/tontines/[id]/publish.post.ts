import { getRouterParam } from 'h3'
import { useDb } from '../../../../db/index.ts'
import { verifierQuotaTontines } from '../../../../services/abonnement.ts'
import { publier } from '../../../../services/tontines.ts'
import { requireKyc, requireMembership } from '../../../../utils/auth.ts'
import { apiError } from '../../../../utils/errors.ts'

/**
 * `draft → open`. Vérifie qu'un canal de collecte vérifié est rattaché.
 *
 * C'est **ici** que le palier KYC 2 est exigé : publier, c'est exposer une
 * tontine à d'autres personnes et devenir le numéro vers lequel elles
 * enverront de l'argent. Le brouillon, lui, n'engage personne.
 *
 * Et c'est ici, pour la même raison, qu'est vérifié le quota d'abonnement :
 * un brouillon n'occupe aucune place, une tontine publiée si. Le contrôle
 * porte sur ce qu'on ouvre, jamais sur ce qui tourne déjà.
 */
export default defineEventHandler(async (event) => {
  const tontineId = getRouterParam(event, 'id')
  if (!tontineId) throw apiError('NOT_FOUND', 'Tontine introuvable.')

  const { user } = await requireMembership(event, tontineId, ['president'])
  requireKyc(user, 2)

  const db = useDb()
  verifierQuotaTontines(db, user)

  publier(db, tontineId)

  return { id: tontineId, status: 'open' as const }
})
