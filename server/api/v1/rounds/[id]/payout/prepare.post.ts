import { getRouterParam, readBody } from 'h3'
import { eq } from 'drizzle-orm'
import { preparePayoutInput } from '../../../../../../shared/schemas/index.ts'
import { useDb } from '../../../../../db/index.ts'
import { rounds } from '../../../../../db/schema.ts'
import { preparerVersement } from '../../../../../services/versements.ts'
import { requireMembership } from '../../../../../utils/auth.ts'
import { apiError, validationError } from '../../../../../utils/errors.ts'
import { withIdempotency } from '../../../../../utils/idempotency.ts'

/** Prépare le versement. Ressaisie des quatre derniers chiffres obligatoire. */
export default defineEventHandler(async (event) => {
  const roundId = getRouterParam(event, 'id')
  if (!roundId) throw apiError('NOT_FOUND', 'Tour introuvable.')

  const db = useDb()
  const [tour] = db.select({ tontineId: rounds.tontineId }).from(rounds).where(eq(rounds.id, roundId)).limit(1).all()
  if (!tour) throw apiError('NOT_FOUND', 'Tour introuvable.')

  const { user, membership } = await requireMembership(event, tour.tontineId, ['treasurer', 'president'])

  const parsed = preparePayoutInput.safeParse(await readBody(event))
  if (!parsed.success) throw validationError(parsed.error)

  // Forcer un versement sur pot incomplet est une décision du président seul.
  if (parsed.data.acceptIncompletePot && membership.role !== 'president') {
    throw apiError(
      'FORBIDDEN',
      'Seul le président peut assumer un versement sur un pot incomplet.',
      { field: 'acceptIncompletePot' },
    )
  }

  return withIdempotency(event, user.id, parsed.data, () =>
    preparerVersement(db, roundId, user.id, parsed.data))
})
