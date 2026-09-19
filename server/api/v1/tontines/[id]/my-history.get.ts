import { getRouterParam } from 'h3'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { useDb } from '../../../../db/index.ts'
import { contributions, paymentDeclarations, payouts, penalties, shares } from '../../../../db/schema.ts'
import { toursDe } from '../../../../services/tours.ts'
import { requireMembership } from '../../../../utils/auth.ts'
import { apiError } from '../../../../utils/errors.ts'

/**
 * Mon historique dans une tontine : tour par tour, ce que j'ai cotisé, ce
 * qui a été confirmé, ce que j'ai reçu, et les reçus que je peux produire.
 *
 * `my-contributions` ne rend que le tour en cours : dès qu'un tour est clos,
 * ses cotisations et leurs reçus devenaient introuvables — alors que le reçu
 * d'il y a six mois est exactement ce qu'on vient chercher le jour d'un
 * désaccord. Le registre les contient, mais sous forme d'écritures du groupe ;
 * ici, c'est le point de vue d'une personne.
 *
 * Tout est calculé côté serveur (règle 2) : le client n'additionne rien.
 */
export default defineEventHandler(async (event) => {
  const tontineId = getRouterParam(event, 'id')
  if (!tontineId) throw apiError('NOT_FOUND', 'Tontine introuvable.')

  const { membership } = await requireMembership(event, tontineId)
  const db = useDb()

  const tours = await toursDe(db, tontineId)
  if (tours.length === 0) return { rounds: [], totalConfirme: 0, totalRecu: 0 }

  const mesParts = new Set(
    (await db.select({ id: shares.id }).from(shares).where(eq(shares.membershipId, membership.id))).map(p => p.id),
  )

  const miennes = await db
    .select()
    .from(contributions)
    .where(and(
      inArray(contributions.roundId, tours.map(t => t.id)),
      eq(contributions.membershipId, membership.id),
    ))

  const declarations = miennes.length === 0
    ? []
    : (await db
        .select()
        .from(paymentDeclarations)
        .where(inArray(paymentDeclarations.contributionId, miennes.map(c => c.id)))
        .orderBy(asc(paymentDeclarations.declaredAt)))

  const amendes = miennes.length === 0
    ? []
    : (await db
        .select()
        .from(penalties)
        .where(inArray(penalties.contributionId, miennes.map(c => c.id))))

  const versements = await db
    .select()
    .from(payouts)
    .where(and(
      inArray(payouts.roundId, tours.map(t => t.id)),
      eq(payouts.beneficiaryMembershipId, membership.id),
    ))

  const parTour = tours.map((tour) => {
    const cotisations = miennes.filter(c => c.roundId === tour.id)
    const versement = versements.find(v => v.roundId === tour.id) ?? null
    return {
      id: tour.id,
      index: tour.index,
      dueDate: tour.dueDate,
      status: tour.status,
      beneficiaryName: tour.beneficiaryName,
      jePrendsLaMain: mesParts.has(tour.beneficiaryShareId),
      attendu: cotisations.reduce((n, c) => n + c.expectedAmount, 0),
      confirme: cotisations.reduce((n, c) => n + c.confirmedAmount, 0),
      cotisations: cotisations.map(c => ({
        id: c.id,
        status: c.status,
        expectedAmount: c.expectedAmount,
        confirmedAmount: c.confirmedAmount,
        declarations: declarations
          .filter(d => d.contributionId === c.id)
          .map(d => ({
            id: d.id,
            amount: d.amount,
            channel: d.channel,
            decision: d.decision,
            declaredAt: d.declaredAt,
            decidedAt: d.decidedAt,
            rejectionReason: d.rejectionReason,
          })),
        amendes: amendes
          .filter(a => a.contributionId === c.id)
          .map(a => ({ id: a.id, amount: a.amount, status: a.status })),
      })),
      versement: versement
        ? {
            status: versement.status,
            amount: versement.amount,
            channel: versement.channel,
            acknowledgedAt: versement.acknowledgedAt,
          }
        : null,
    }
  })

  return {
    rounds: parTour,
    totalConfirme: parTour.reduce((n, t) => n + t.confirme, 0),
    totalRecu: versements
      .filter(v => v.status === 'acknowledged' || v.status === 'declared')
      .reduce((n, v) => n + v.amount, 0),
  }
})
