import { getRouterParam } from 'h3'
import { useDb } from '../../../../db/index.ts'
import { dateDuJour, demarrerTontine } from '../../../../services/tours.ts'
import { requireMembership } from '../../../../utils/auth.ts'
import { apiError } from '../../../../utils/errors.ts'

/**
 * `open → running`. Fige la rotation et génère tous les tours et cotisations.
 *
 * Le geste est irréversible : à partir de là, l'ordre de passage ne bouge plus
 * sans contre-validation, et les dus de chacun sont posés pour tout le cycle.
 */
export default defineEventHandler(async (event) => {
  const tontineId = getRouterParam(event, 'id')
  if (!tontineId) throw apiError('NOT_FOUND', 'Tontine introuvable.')

  const { user } = await requireMembership(event, tontineId, ['president'])
  // La date du jour est passée ici, pas devinée par le service : c'est ce qui
  // permet de refuser un démarrage dont le premier tour serait déjà passé.
  return await demarrerTontine(useDb(), tontineId, user.id, { aujourdhui: dateDuJour() })
})
