import { getRouterParam, readBody } from 'h3'
import { eq } from 'drizzle-orm'
import { declarePayoutInput } from '../../../../../../shared/schemas/index.ts'
import { useDb } from '../../../../../db/index.ts'
import { rounds } from '../../../../../db/schema.ts'
import { declarerVersement } from '../../../../../services/versements.ts'
import { requireMembership } from '../../../../../utils/auth.ts'
import { apiError, validationError } from '../../../../../utils/errors.ts'
import { withIdempotency } from '../../../../../utils/idempotency.ts'

/** Déclare l'envoi du pot au bénéficiaire. */
export default defineEventHandler(async (event) => {
  const roundId = getRouterParam(event, 'id')
  if (!roundId) throw apiError('NOT_FOUND', 'Tour introuvable.')

  const db = useDb()
  const [tour] = db.select({ tontineId: rounds.tontineId }).from(rounds).where(eq(rounds.id, roundId)).limit(1).all()
  if (!tour) throw apiError('NOT_FOUND', 'Tour introuvable.')

  const { user } = await requireMembership(event, tour.tontineId, ['treasurer', 'president'])

  const parsed = declarePayoutInput.safeParse(await readBody(event))
  if (!parsed.success) throw validationError(parsed.error)

  return withIdempotency(event, user.id, parsed.data, () =>
    declarerVersement(db, roundId, user.id, parsed.data))
})
