import { getRouterParam } from 'h3'
import { useDb } from '../../../../db/index.ts'
import { litigesDe } from '../../../../services/litiges.ts'
import { requireMembership } from '../../../../utils/auth.ts'
import { apiError } from '../../../../utils/errors.ts'

/**
 * Les contestations d'une tontine, avec leur fil — **pour tout membre actif**.
 *
 * Elles ne se lisaient que sur l'écran des impayés, réservé au bureau par la
 * navigation : le membre qui avait signalé une erreur ne voyait ni les
 * réponses ni la conclusion. Un fil où seul le bureau lit n'est pas une
 * contestation, c'est un guichet.
 */
export default defineEventHandler(async (event) => {
  const tontineId = getRouterParam(event, 'id')
  if (!tontineId) throw apiError('NOT_FOUND', 'Tontine introuvable.')

  const { membership } = await requireMembership(event, tontineId)
  return { myRole: membership.role, litiges: litigesDe(useDb(), tontineId) }
})
