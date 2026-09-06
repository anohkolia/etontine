import { getRouterParam, readBody } from 'h3'
import { z } from 'zod'
import { useDb } from '../../../../../server/db/index.ts'
import { rejeterDemande } from '../../../../../server/services/abonnement.ts'
import { apiError, validationError } from '../../../../../server/utils/errors.ts'
import { requireAdmin } from '../../../utils/garde.ts'

/** Refuse une demande. Le motif est obligatoire et parvient au président. */
const rejetInput = z.object({
  reason: z.string().trim().min(10, 'Explique ce qui manque').max(500),
})

export default defineEventHandler(async (event) => {
  const admin = requireAdmin(event)

  const id = getRouterParam(event, 'id')
  if (!id) throw apiError('NOT_FOUND', 'Demande introuvable.')

  const parsed = rejetInput.safeParse(await readBody(event))
  if (!parsed.success) throw validationError(parsed.error)

  return rejeterDemande(useDb(), id, admin, parsed.data.reason)
})
