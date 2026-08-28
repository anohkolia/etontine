import { getRouterParam } from 'h3'
import { eq } from 'drizzle-orm'
import { useDb } from '../../../../db/index.ts'
import { contributions, memberships, rounds, tontines } from '../../../../db/schema.ts'
import { canauxDeTontine } from '../../../../services/canaux.ts'
import { estimerFrais, referenceCourte } from '../../../../services/frais.ts'
import type { Bareme } from '../../../../services/frais.ts'
import { requireMembership } from '../../../../utils/auth.ts'
import { apiError } from '../../../../utils/errors.ts'

/**
 * Écran « où envoyer » : tout ce qu'il faut pour effectuer le paiement.
 *
 * Le **nom du titulaire** est toujours renvoyé, et l'interface l'affiche
 * toujours : c'est la protection anti-arnaque n°1. Le membre le compare à ce
 * que son application de paiement lui montre avant de valider. Un numéro seul
 * ne prouve rien ; un nom qui ne correspond pas arrête le geste.
 */
export default defineEventHandler(async (event) => {
  const contributionId = getRouterParam(event, 'id')
  if (!contributionId) throw apiError('NOT_FOUND', 'Cotisation introuvable.')

  const db = useDb()

  const [ligne] = db
    .select({
      contribution: contributions,
      tontineId: rounds.tontineId,
      roundIndex: rounds.index,
      membershipUserId: memberships.userId,
    })
    .from(contributions)
    .innerJoin(rounds, eq(rounds.id, contributions.roundId))
    .innerJoin(memberships, eq(memberships.id, contributions.membershipId))
    .where(eq(contributions.id, contributionId))
    .limit(1)
    .all()

  if (!ligne) throw apiError('NOT_FOUND', 'Cotisation introuvable.')

  const { user } = await requireMembership(event, ligne.tontineId)

  const [tontine] = db.select().from(tontines).where(eq(tontines.id, ligne.tontineId)).limit(1).all()
  const canaux = canauxDeTontine(db, ligne.tontineId)

  if (canaux.length === 0) {
    throw apiError('NOT_FOUND', 'Aucun numéro de collecte n’est rattaché à cette tontine.')
  }

  const bareme = useRuntimeConfig(event).fees as unknown as Bareme
  const restant = Math.max(0, ligne.contribution.expectedAmount - ligne.contribution.confirmedAmount)

  return {
    contributionId,
    roundIndex: ligne.roundIndex,
    status: ligne.contribution.status,
    dueDate: ligne.contribution.dueDate,
    /** Le dû restant, calculé côté serveur. Le client ne le recalcule jamais. */
    expectedAmount: restant,
    feesBearer: tontine!.feesBearer,
    /** Une référence courte et stable, à recopier en commentaire du paiement. */
    reference: referenceCourte(contributionId),
    /** C'est bien la cotisation de l'appelant, ou celle de quelqu'un d'autre. */
    isMine: ligne.membershipUserId === user.id,
    channels: canaux.map(canal => ({
      id: canal.id,
      provider: canal.provider,
      msisdn: canal.msisdn,
      // Toujours présent, jamais optionnel : c'est ce que le membre vérifie.
      holderName: canal.holderName,
      paymentLinkUrl: canal.paymentLinkUrl,
      frozenUntil: canal.frozenUntil,
      fees: estimerFrais(bareme, canal.provider, restant, tontine!.feesBearer),
    })),
  }
})
