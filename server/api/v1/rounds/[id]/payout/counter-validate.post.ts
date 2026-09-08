import { getRouterParam } from 'h3'
import { eq } from 'drizzle-orm'
import { useDb } from '../../../../../db/index.ts'
import { rounds } from '../../../../../db/schema.ts'
import { contreValiderVersement } from '../../../../../services/versements.ts'
import { requireMembership } from '../../../../../utils/auth.ts'
import { apiError } from '../../../../../utils/errors.ts'

/**
 * Contre-validation : président, censeur **ou bénéficiaire du tour**, et
 * toujours différent du préparateur.
 *
 * Aucune liste de rôles ici : le droit dépend aussi de qui reçoit le pot, ce
 * que seul le service sait. Il tranche, et renvoie 403 s'il le faut.
 */
export default defineEventHandler(async (event) => {
  const roundId = getRouterParam(event, 'id')
  if (!roundId) throw apiError('NOT_FOUND', 'Tour introuvable.')

  const db = useDb()
  const [tour] = db.select({ tontineId: rounds.tontineId }).from(rounds).where(eq(rounds.id, roundId)).limit(1).all()
  if (!tour) throw apiError('NOT_FOUND', 'Tour introuvable.')

  const { user } = await requireMembership(event, tour.tontineId)
  return contreValiderVersement(db, roundId, user.id)
})
