import { readBody } from 'h3'
import { eq } from 'drizzle-orm'
import { advanceInput } from '../../../shared/schemas/index.ts'
import { useDb } from '../../db/index.ts'
import { rounds } from '../../db/schema.ts'
import { enregistrerAvance } from '../../services/avances.ts'
import { requireMembership } from '../../utils/auth.ts'
import { apiError, validationError } from '../../utils/errors.ts'

/** Enregistre une avance entre membres. Le bureau la consigne. */
export default defineEventHandler(async (event) => {
  const parsed = advanceInput.safeParse(await readBody(event))
  if (!parsed.success) throw validationError(parsed.error)

  const db = useDb()
  const [tour] = db.select({ tontineId: rounds.tontineId }).from(rounds)
    .where(eq(rounds.id, parsed.data.roundId)).limit(1).all()

  if (!tour) throw apiError('NOT_FOUND', 'Tour introuvable.')

  await requireMembership(event, tour.tontineId, ['treasurer', 'president'])
  return enregistrerAvance(db, parsed.data)
})
