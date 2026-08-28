import { getRouterParam, readBody } from 'h3'
import { eq } from 'drizzle-orm'
import { waivePenaltyInput } from '../../../../../shared/schemas/index.ts'
import { useDb } from '../../../../db/index.ts'
import { contributions, penalties, rounds } from '../../../../db/schema.ts'
import { annulerAmende } from '../../../../services/amendes.ts'
import { requireMembership } from '../../../../utils/auth.ts'
import { apiError, validationError } from '../../../../utils/errors.ts'

/** Annule une amende. Le motif est obligatoire et part au registre. */
export default defineEventHandler(async (event) => {
  const penaltyId = getRouterParam(event, 'id')
  if (!penaltyId) throw apiError('NOT_FOUND', 'Amende introuvable.')

  const db = useDb()
  const [ligne] = db
    .select({ tontineId: rounds.tontineId })
    .from(penalties)
    .innerJoin(contributions, eq(contributions.id, penalties.contributionId))
    .innerJoin(rounds, eq(rounds.id, contributions.roundId))
    .where(eq(penalties.id, penaltyId))
    .limit(1)
    .all()

  if (!ligne) throw apiError('NOT_FOUND', 'Amende introuvable.')

  const { user } = await requireMembership(event, ligne.tontineId, ['president'])

  const parsed = waivePenaltyInput.safeParse(await readBody(event))
  if (!parsed.success) throw validationError(parsed.error)

  return annulerAmende(db, penaltyId, user.id, parsed.data.reason)
})
