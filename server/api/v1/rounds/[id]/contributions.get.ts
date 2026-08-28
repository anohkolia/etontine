import { getQuery, getRouterParam } from 'h3'
import { asc, eq } from 'drizzle-orm'
import { useDb } from '../../../../db/index.ts'
import { contributions, memberships, rounds, shares, users } from '../../../../db/schema.ts'
import { requireMembership } from '../../../../utils/auth.ts'
import { apiError } from '../../../../utils/errors.ts'

/** Les cotisations d'un tour. Lisible par tout membre actif. */
export default defineEventHandler(async (event) => {
  const roundId = getRouterParam(event, 'id')
  if (!roundId) throw apiError('NOT_FOUND', 'Tour introuvable.')

  const db = useDb()
  const [tour] = db.select({ tontineId: rounds.tontineId }).from(rounds)
    .where(eq(rounds.id, roundId)).limit(1).all()

  if (!tour) throw apiError('NOT_FOUND', 'Tour introuvable.')
  await requireMembership(event, tour.tontineId)

  const filtre = getQuery(event).status
  const lignes = db
    .select({
      id: contributions.id,
      membershipId: contributions.membershipId,
      rotationPosition: shares.rotationPosition,
      expectedAmount: contributions.expectedAmount,
      confirmedAmount: contributions.confirmedAmount,
      status: contributions.status,
      dueDate: contributions.dueDate,
      managedName: memberships.managedName,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(contributions)
    .innerJoin(shares, eq(shares.id, contributions.shareId))
    .innerJoin(memberships, eq(memberships.id, contributions.membershipId))
    .leftJoin(users, eq(users.id, memberships.userId))
    .where(eq(contributions.roundId, roundId))
    .orderBy(asc(shares.rotationPosition))
    .all()

  const items = lignes
    .filter(l => (typeof filtre === 'string' ? l.status === filtre : true))
    .map(l => ({
      ...l,
      nom: [l.firstName, l.lastName].filter(Boolean).join(' ') || l.managedName || 'Membre',
    }))

  return { items }
})
