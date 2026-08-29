import { getRouterParam } from 'h3'
import { useDb } from '../../../../../server/db/index.ts'
import { dossier } from '../../../../../server/services/kyc.ts'
import { apiError } from '../../../../../server/utils/errors.ts'
import { requireAdmin } from '../../../utils/garde.ts'

export default defineEventHandler((event) => {
  requireAdmin(event)

  const id = getRouterParam(event, 'id')
  if (!id) throw apiError('NOT_FOUND', 'Dossier introuvable.')

  return dossier(useDb(), id)
})
