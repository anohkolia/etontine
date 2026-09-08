import { getRouterParam } from 'h3'
import { and, eq, inArray } from 'drizzle-orm'
import { useDb } from '../../../../db/index.ts'
import { contributions, memberships, rounds, shares, users } from '../../../../db/schema.ts'
import { amendesDe, calculerAmende, reglesDe } from '../../../../services/amendes.ts'
import { avancesDe } from '../../../../services/avances.ts'
import { litigesDe } from '../../../../services/litiges.ts'
import { requireMembership } from '../../../../utils/auth.ts'
import { apiError } from '../../../../utils/errors.ts'

/**
 * Retards, amendes, avances et contestations, en un seul appel.
 *
 * L'amende affichée est un **calcul**, pas une dette : elle indique ce que le
 * barème donnerait si le président décidait de l'appliquer. Rien n'est écrit
 * tant qu'il n'a pas agi (docs/data-model.md §5).
 */
export default defineEventHandler(async (event) => {
  const tontineId = getRouterParam(event, 'id')
  if (!tontineId) throw apiError('NOT_FOUND', 'Tontine introuvable.')

  const { membership } = await requireMembership(event, tontineId)
  const db = useDb()
  const regles = reglesDe(db, tontineId)

  const enRetard = db
    .select({
      contributionId: contributions.id,
      roundId: rounds.id,
      roundIndex: rounds.index,
      dueDate: contributions.dueDate,
      expectedAmount: contributions.expectedAmount,
      confirmedAmount: contributions.confirmedAmount,
      status: contributions.status,
      rotationPosition: shares.rotationPosition,
      membershipId: memberships.id,
      managedName: memberships.managedName,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(contributions)
    .innerJoin(rounds, eq(rounds.id, contributions.roundId))
    .innerJoin(shares, eq(shares.id, contributions.shareId))
    .innerJoin(memberships, eq(memberships.id, contributions.membershipId))
    .leftJoin(users, eq(users.id, memberships.userId))
    .where(and(
      eq(rounds.tontineId, tontineId),
      inArray(contributions.status, ['late', 'disputed']),
    ))
    .all()

  // Les membres actifs, pour l'écran d'avance : il faut désigner qui dépanne.
  // Ils voyagent avec le reste plutôt que dans un second appel — c'est la
  // promesse de cette route, tout ce qu'il faut pour peindre l'écran d'un coup.
  const membres = db
    .select({
      id: memberships.id,
      managedName: memberships.managedName,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(memberships)
    .leftJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.tontineId, tontineId), eq(memberships.status, 'active')))
    .all()
    .map(m => ({
      id: m.id,
      nom: [m.firstName, m.lastName].filter(Boolean).join(' ') || m.managedName || 'Membre',
    }))

  return {
    myRole: membership.role,
    membres,
    regles,
    retards: enRetard.map(r => ({
      ...r,
      nom: [r.firstName, r.lastName].filter(Boolean).join(' ') || r.managedName || 'Membre',
      restant: r.expectedAmount - r.confirmedAmount,
      // Ce que le barème donnerait aujourd'hui. Aucune écriture, aucune dette.
      amendeCalculee: calculerAmende(regles, r.dueDate),
    })),
    amendes: amendesDe(db, tontineId),
    avances: avancesDe(db, tontineId),
    litiges: litigesDe(db, tontineId),
  }
})
