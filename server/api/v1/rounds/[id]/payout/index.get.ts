import { getRouterParam } from 'h3'
import { eq } from 'drizzle-orm'
import { useDb } from '../../../../../db/index.ts'
import { rounds } from '../../../../../db/schema.ts'
import { etatVersement } from '../../../../../services/versements.ts'
import { requireMembership } from '../../../../../utils/auth.ts'
import { apiError } from '../../../../../utils/errors.ts'

/** Écran de préparation : pot constitué, manquants, bénéficiaire, alertes. */
export default defineEventHandler(async (event) => {
  const roundId = getRouterParam(event, 'id')
  if (!roundId) throw apiError('NOT_FOUND', 'Tour introuvable.')

  const db = useDb()
  const [tour] = db.select({ tontineId: rounds.tontineId }).from(rounds).where(eq(rounds.id, roundId)).limit(1).all()
  if (!tour) throw apiError('NOT_FOUND', 'Tour introuvable.')

  const { user, membership } = await requireMembership(event, tour.tontineId)
  const etat = etatVersement(db, roundId, user.id)

  // Le bureau, et le bénéficiaire du tour — il a désormais un geste à faire
  // ici, et cet écran porte le numéro vers lequel le pot va partir : on ne
  // l'ouvre pas à toute la tontine pour autant.
  const duBureau = ['treasurer', 'president', 'auditor'].includes(membership.role)
  if (!duBureau && membership.id !== etat.beneficiary.membershipId) {
    throw apiError(
      'FORBIDDEN',
      'Cet écran est réservé au bureau et au bénéficiaire du tour.',
    )
  }

  return etat
})
