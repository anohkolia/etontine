import { getRouterParam } from 'h3'
import { useDb } from '../../../../../server/db/index.ts'
import { approuverDossier } from '../../../../../server/services/kyc.ts'
import { apiError } from '../../../../../server/utils/errors.ts'
import { requireAdmin } from '../../../utils/garde.ts'

/** Approuve un dossier : le palier 2 est accordé, la décision est journalisée. */
export default defineEventHandler((event) => {
  const admin = requireAdmin(event)

  const id = getRouterParam(event, 'id')
  if (!id) throw apiError('NOT_FOUND', 'Dossier introuvable.')

  return approuverDossier(useDb(), id, admin)
})
