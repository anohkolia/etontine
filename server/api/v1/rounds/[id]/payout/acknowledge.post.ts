import { getRouterParam, readBody } from 'h3'
import { eq } from 'drizzle-orm'
import { acknowledgePayoutInput } from '../../../../../../shared/schemas/index.ts'
import { useDb } from '../../../../../db/index.ts'
import { rounds } from '../../../../../db/schema.ts'
import { accuserReception } from '../../../../../services/versements.ts'
import { requireMembership } from '../../../../../utils/auth.ts'
import { apiError, validationError } from '../../../../../utils/errors.ts'
import { withIdempotency } from '../../../../../utils/idempotency.ts'

/**
 * Accusé de réception du pot. **Bénéficiaire uniquement**, et c'est ce qui
 * clôt le tour.
 *
 * Aucun rôle n'est exigé ici : le bénéficiaire est un simple membre. C'est le
 * service qui vérifie que l'appelant est bien celui qui devait recevoir.
 */
export default defineEventHandler(async (event) => {
  const roundId = getRouterParam(event, 'id')
  if (!roundId) throw apiError('NOT_FOUND', 'Tour introuvable.')

  const db = useDb()
  const [tour] = db.select({ tontineId: rounds.tontineId }).from(rounds).where(eq(rounds.id, roundId)).limit(1).all()
  if (!tour) throw apiError('NOT_FOUND', 'Tour introuvable.')

  const { user } = await requireMembership(event, tour.tontineId)

  const parsed = acknowledgePayoutInput.safeParse(await readBody(event))
  if (!parsed.success) throw validationError(parsed.error)

  return withIdempotency(event, user.id, parsed.data, () =>
    accuserReception(db, roundId, user.id, parsed.data.receivedAmount))
})
