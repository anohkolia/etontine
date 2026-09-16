import { getRouterParam } from 'h3'
import { useDb } from '../../../../db/index.ts'
import { supprimerBrouillon } from '../../../../services/tontines.ts'
import { requireMembership } from '../../../../utils/auth.ts'
import { apiError } from '../../../../utils/errors.ts'

/**
 * Supprime un brouillon. Réservé au président, refusé dès que la tontine est
 * publiée : à partir de là, d'autres personnes la voient et sa fin s'écrit.
 */
export default defineEventHandler(async (event) => {
  const tontineId = getRouterParam(event, 'id')
  if (!tontineId) throw apiError('NOT_FOUND', 'Tontine introuvable.')

  await requireMembership(event, tontineId, ['president'])
  await supprimerBrouillon(useDb(), tontineId)
  return { ok: true }
})
