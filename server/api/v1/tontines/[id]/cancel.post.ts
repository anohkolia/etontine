import { getRouterParam, readBody } from 'h3'
import { z } from 'zod'
import { useDb } from '../../../../db/index.ts'
import { annulerTontine } from '../../../../services/tontines.ts'
import { requireMembership } from '../../../../utils/auth.ts'
import { apiError, validationError } from '../../../../utils/errors.ts'

/**
 * `open → archived` : annule une tontine publiée qui n'a pas démarré.
 *
 * Le motif est obligatoire : il part au registre et c'est ce que les membres
 * liront. Une tontine en cours ne s'annule pas — la machine à états le refuse.
 */
const cancelInput = z.object({
  reason: z.string().trim().min(5, 'Explique brièvement pourquoi').max(300),
})

export default defineEventHandler(async (event) => {
  const tontineId = getRouterParam(event, 'id')
  if (!tontineId) throw apiError('NOT_FOUND', 'Tontine introuvable.')

  const { user } = await requireMembership(event, tontineId, ['president'])

  const parsed = cancelInput.safeParse(await readBody(event))
  if (!parsed.success) throw validationError(parsed.error)

  annulerTontine(useDb(), tontineId, user.id, parsed.data.reason)
  return { ok: true }
})
