import { getRouterParam, readBody } from 'h3'
import { z } from 'zod'
import { useDb } from '../../../../../server/db/index.ts'
import { rejeterDossier } from '../../../../../server/services/kyc.ts'
import { apiError, validationError } from '../../../../../server/utils/errors.ts'
import { requireAdmin } from '../../../utils/garde.ts'

/** Rejette un dossier. Le motif est obligatoire et parvient à la personne. */
const rejetInput = z.object({
  reason: z.string().trim().min(10, 'Explique ce qui doit être corrigé').max(500),
})

export default defineEventHandler(async (event) => {
  const admin = requireAdmin(event)

  const id = getRouterParam(event, 'id')
  if (!id) throw apiError('NOT_FOUND', 'Dossier introuvable.')

  const parsed = rejetInput.safeParse(await readBody(event))
  if (!parsed.success) throw validationError(parsed.error)

  return rejeterDossier(useDb(), id, admin, parsed.data.reason)
})
