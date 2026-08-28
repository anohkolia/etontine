import { getRouterParam, getQuery } from 'h3'
import { useDb } from '../../../../db/index.ts'
import { readLedger } from '../../../../services/ledger.ts'
import { requireMembership } from '../../../../utils/auth.ts'
import { apiError } from '../../../../utils/errors.ts'
import type { LedgerType } from '../../../../db/schema.ts'

/**
 * Registre d'une tontine, paginé.
 *
 * **Accessible à tout membre actif**, sans distinction de rôle : un registre
 * que seul le bureau peut lire ne vaut rien. C'est la pièce qui remplace le
 * carnet posé sur la table, et tout le monde doit pouvoir s'y reporter.
 */
export default defineEventHandler(async (event) => {
  const tontineId = getRouterParam(event, 'id')
  if (!tontineId) throw apiError('NOT_FOUND', 'Tontine introuvable.')

  await requireMembership(event, tontineId)

  const q = getQuery(event)
  return readLedger(useDb(), tontineId, {
    roundId: typeof q.roundId === 'string' ? q.roundId : undefined,
    type: typeof q.type === 'string' ? q.type as LedgerType : undefined,
    limit: q.limit ? Number(q.limit) : undefined,
  })
})
