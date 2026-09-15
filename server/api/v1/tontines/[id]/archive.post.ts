import { getRouterParam } from 'h3'
import { useDb } from '../../../../db/index.ts'
import { archiverTontine } from '../../../../services/tontines.ts'
import { requireMembership } from '../../../../utils/auth.ts'
import { apiError } from '../../../../utils/errors.ts'

/**
 * `closed → archived` : range une tontine terminée.
 *
 * Elle quitte le tableau de bord, pas le registre : l'historique reste lisible
 * et exportable par chaque membre.
 */
export default defineEventHandler(async (event) => {
  const tontineId = getRouterParam(event, 'id')
  if (!tontineId) throw apiError('NOT_FOUND', 'Tontine introuvable.')

  const { user } = await requireMembership(event, tontineId, ['president'])
  archiverTontine(useDb(), tontineId, user.id)
  return { ok: true }
})
