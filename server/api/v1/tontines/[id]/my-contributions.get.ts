import { getRouterParam } from 'h3'
import { and, eq, inArray } from 'drizzle-orm'
import { useDb } from '../../../../db/index.ts'
import { contributions, memberships, paymentDeclarations, rounds, shares } from '../../../../db/schema.ts'
import { requireMembership } from '../../../../utils/auth.ts'
import { apiError } from '../../../../utils/errors.ts'

/**
 * Mes cotisations sur le tour en cours.
 *
 * Au **pluriel**, et ce n'est pas une précaution de style : un membre à deux
 * parts a deux cotisations par tour, et doit envoyer deux fois. Un écran qui
 * n'en montrerait qu'une le laisserait croire qu'il est à jour alors qu'il doit
 * encore la moitié.
 */
export default defineEventHandler(async (event) => {
  const tontineId = getRouterParam(event, 'id')
  if (!tontineId) throw apiError('NOT_FOUND', 'Tontine introuvable.')

  const { membership } = await requireMembership(event, tontineId)
  const db = useDb()

  const tours = db
    .select({ id: rounds.id, index: rounds.index, dueDate: rounds.dueDate, status: rounds.status })
    .from(rounds)
    .where(and(
      eq(rounds.tontineId, tontineId),
      inArray(rounds.status, ['collecting', 'payout_pending']),
    ))
    .all()

  if (tours.length === 0) return { round: null, contributions: [] }

  const miennes = db
    .select({
      id: contributions.id,
      roundId: contributions.roundId,
      shareId: contributions.shareId,
      rotationPosition: shares.rotationPosition,
      expectedAmount: contributions.expectedAmount,
      confirmedAmount: contributions.confirmedAmount,
      status: contributions.status,
      dueDate: contributions.dueDate,
    })
    .from(contributions)
    .innerJoin(shares, eq(shares.id, contributions.shareId))
    .innerJoin(memberships, eq(memberships.id, contributions.membershipId))
    .where(and(
      inArray(contributions.roundId, tours.map(t => t.id)),
      eq(memberships.id, membership.id),
    ))
    .all()

  // Les déclarations encore en attente sur mes cotisations.
  //
  // L'écran en a besoin pour un cas qu'il ignorait complètement : le trésorier
  // a enregistré des espèces **à ma place**. Je n'ai rien déclaré, ma cotisation
  // passe en « déclarée », et je n'avais aucun moyen de dire si je reconnais ce
  // versement. C'est pourtant la contrepartie exacte de cette dissymétrie —
  // sans elle, le bureau peut porter au registre des versements qui n'ont
  // jamais eu lieu.
  const declarations = miennes.length === 0
    ? []
    : db
        .select({
          id: paymentDeclarations.id,
          contributionId: paymentDeclarations.contributionId,
          amount: paymentDeclarations.amount,
          channel: paymentDeclarations.channel,
          source: paymentDeclarations.source,
          declaredAt: paymentDeclarations.declaredAt,
          declaredBy: paymentDeclarations.declaredBy,
          memberAcknowledgedAt: paymentDeclarations.memberAcknowledgedAt,
        })
        .from(paymentDeclarations)
        .where(and(
          inArray(paymentDeclarations.contributionId, miennes.map(c => c.id)),
          eq(paymentDeclarations.decision, 'pending'),
        ))
        .all()

  return { round: tours[0], contributions: miennes, declarations }
})
