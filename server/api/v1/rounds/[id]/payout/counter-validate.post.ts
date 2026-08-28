import { getRouterParam } from 'h3'
import { eq } from 'drizzle-orm'
import { useDb } from '../../../../../db/index.ts'
import { rounds } from '../../../../../db/schema.ts'
import { contreValiderVersement } from '../../../../../services/versements.ts'
import { requireMembership } from '../../../../../utils/auth.ts'
import { apiError } from '../../../../../utils/errors.ts'

/** Contre-validation : président ou censeur, différent du préparateur. */
export default defineEventHandler(async (event) => {
  const roundId = getRouterParam(event, 'id')
  if (!roundId) throw apiError('NOT_FOUND', 'Tour introuvable.')

  const db = useDb()
  const [tour] = db.select({ tontineId: rounds.tontineId }).from(rounds).where(eq(rounds.id, roundId)).limit(1).all()
  if (!tour) throw apiError('NOT_FOUND', 'Tour introuvable.')

  const { user } = await requireMembership(event, tour.tontineId, ['president', 'auditor'])
  return contreValiderVersement(db, roundId, user.id)
})
