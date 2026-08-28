import { and, asc, eq } from 'drizzle-orm'
import type { useDb } from '../db/index.ts'
import {
  contributions, memberships, paymentDeclarations, rounds, shares, users,
} from '../db/schema.ts'
import { apiError } from '../utils/errors.ts'
import { assertTransition } from '../utils/transitions.ts'
import { appendLedger } from './ledger.ts'
import { notifier } from './notifications.ts'

type Db = ReturnType<typeof useDb>

/** La file d'attente du trésorier : les déclarations en attente de décision. */
export function fileDAttente(db: Db, tontineId: string) {
  return db
    .select({
      declarationId: paymentDeclarations.id,
      contributionId: paymentDeclarations.contributionId,
      amount: paymentDeclarations.amount,
      channel: paymentDeclarations.channel,
      providerRef: paymentDeclarations.providerRef,
      proofUrl: paymentDeclarations.proofUrl,
      declaredAt: paymentDeclarations.declaredAt,
      declaredBy: paymentDeclarations.declaredBy,
      escalatedAt: paymentDeclarations.escalatedAt,
      source: paymentDeclarations.source,
      roundIndex: rounds.index,
      rotationPosition: shares.rotationPosition,
      membershipId: memberships.id,
      memberName: memberships.managedName,
      memberFirstName: users.firstName,
      memberLastName: users.lastName,
      expectedAmount: contributions.expectedAmount,
      confirmedAmount: contributions.confirmedAmount,
    })
    .from(paymentDeclarations)
    .innerJoin(contributions, eq(contributions.id, paymentDeclarations.contributionId))
    .innerJoin(rounds, eq(rounds.id, contributions.roundId))
    .innerJoin(shares, eq(shares.id, contributions.shareId))
    .innerJoin(memberships, eq(memberships.id, contributions.membershipId))
    .leftJoin(users, eq(users.id, memberships.userId))
    .where(and(
      eq(rounds.tontineId, tontineId),
      eq(paymentDeclarations.decision, 'pending'),
    ))
    .orderBy(asc(paymentDeclarations.declaredAt))
    .all()
}

interface ContexteDeclaration {
  declaration: typeof paymentDeclarations.$inferSelect
  contribution: typeof contributions.$inferSelect
  tontineId: string
  roundId: string
  membershipId: string
}

function contexte(db: Db, declarationId: string): ContexteDeclaration {
  const [ligne] = db
    .select({
      declaration: paymentDeclarations,
      contribution: contributions,
      tontineId: rounds.tontineId,
      roundId: rounds.id,
    })
    .from(paymentDeclarations)
    .innerJoin(contributions, eq(contributions.id, paymentDeclarations.contributionId))
    .innerJoin(rounds, eq(rounds.id, contributions.roundId))
    .where(eq(paymentDeclarations.id, declarationId))
    .limit(1)
    .all()

  if (!ligne) throw apiError('NOT_FOUND', 'Déclaration introuvable.')

  return { ...ligne, membershipId: ligne.contribution.membershipId }
}

/**
 * Confirme une déclaration.
 *
 * **Règle de séparation, vérifiée côté serveur** (docs/data-model.md §2.4) :
 * `declared_by ≠ decided_by`. Personne ne valide sa propre déclaration, pas
 * même le trésorier pour sa propre cotisation. C'est le contrôle qui empêche un
 * organisateur de se déclarer à jour tout seul, et il n'a de valeur que s'il
 * est appliqué ici — masquer un bouton côté client n'empêche rien.
 */
export function confirmerDeclaration(db: Db, declarationId: string, decideurId: string) {
  const { declaration, contribution, tontineId, roundId, membershipId } = contexte(db, declarationId)

  if (declaration.decision !== 'pending') {
    // Déjà décidée : ce n'est pas une erreur, c'est un rejeu. On le dit sans
    // rien changer — c'est ce qui rend « tout confirmer » idempotent.
    return { declarationId, dejaDecidee: true, contributionStatus: contribution.status }
  }

  if (declaration.declaredBy === decideurId) {
    throw apiError(
      'FORBIDDEN',
      'Tu ne peux pas confirmer ta propre déclaration. Un autre membre du bureau doit le faire.',
    )
  }

  assertTransition('contribution', contribution.status, 'confirmed')

  const maintenant = new Date()
  db.update(paymentDeclarations)
    .set({ decision: 'confirmed', decidedBy: decideurId, decidedAt: maintenant })
    .where(eq(paymentDeclarations.id, declarationId))
    .run()

  // Les paiements partiels sont autorisés : on cumule, et la cotisation n'est
  // « confirmée » que lorsque le dû est atteint.
  const cumul = contribution.confirmedAmount + declaration.amount
  const soldee = cumul >= contribution.expectedAmount

  db.update(contributions)
    .set({ confirmedAmount: cumul, status: soldee ? 'confirmed' : 'due' })
    .where(eq(contributions.id, contribution.id))
    .run()

  appendLedger(db, {
    tontineId,
    roundId,
    type: 'contribution_confirmed',
    actorId: decideurId,
    payload: {
      contributionId: contribution.id,
      declarationId,
      amount: declaration.amount,
      confirmedTotal: cumul,
      complete: soldee,
    },
  })

  notifierMembre(db, membershipId, tontineId, {
    type: 'cotisation_confirmee',
    title: 'Ta cotisation est confirmée',
    body: 'Le trésorier a confirmé ta cotisation. Elle apparaît au registre.',
    url: `/app/tontine/${tontineId}/registre`,
  })

  return { declarationId, dejaDecidee: false, contributionStatus: soldee ? 'confirmed' : 'due' }
}

/**
 * Rejette une déclaration. **Le motif est obligatoire.**
 *
 * Un rejet sans explication, sur de l'argent qu'on affirme avoir envoyé, est
 * la meilleure façon de casser une tontine. Le membre doit savoir ce qui cloche
 * — mauvais montant, envoi introuvable, référence absente — pour pouvoir
 * corriger ou contester.
 */
export function rejeterDeclaration(
  db: Db,
  declarationId: string,
  decideurId: string,
  motif: string,
) {
  const { declaration, contribution, tontineId, roundId, membershipId } = contexte(db, declarationId)

  if (!motif || motif.trim().length < 5) {
    throw apiError('VALIDATION_ERROR', 'Explique brièvement le motif du rejet.', { field: 'reason' })
  }

  if (declaration.decision !== 'pending') {
    throw apiError('INVALID_TRANSITION', 'Cette déclaration a déjà été traitée.', { field: 'decision' })
  }

  if (declaration.declaredBy === decideurId) {
    throw apiError('FORBIDDEN', 'Tu ne peux pas statuer sur ta propre déclaration.')
  }

  assertTransition('contribution', contribution.status, 'disputed')

  db.update(paymentDeclarations)
    .set({
      decision: 'rejected',
      decidedBy: decideurId,
      decidedAt: new Date(),
      rejectionReason: motif.trim(),
    })
    .where(eq(paymentDeclarations.id, declarationId))
    .run()

  db.update(contributions)
    .set({ status: 'disputed' })
    .where(eq(contributions.id, contribution.id))
    .run()

  appendLedger(db, {
    tontineId,
    roundId,
    type: 'contribution_rejected',
    actorId: decideurId,
    payload: { contributionId: contribution.id, declarationId, reason: motif.trim() },
  })

  notifierMembre(db, membershipId, tontineId, {
    type: 'cotisation_rejetee',
    title: 'Ta déclaration a été rejetée',
    body: 'Le trésorier n’a pas retrouvé ton envoi. Ouvre l’application pour voir le motif.',
    url: `/app/tontine/${tontineId}/cotiser`,
  })

  return { declarationId, contributionStatus: 'disputed' as const }
}

/**
 * « Tout confirmer » du trésorier.
 *
 * **Idempotent** (acceptation T16) : une déclaration déjà décidée est passée,
 * pas rejouée. Le trésorier qui retape sur le bouton parce que la liste n'a pas
 * bougé ne doit pas provoquer de double comptage.
 *
 * Ses propres déclarations sont ignorées silencieusement plutôt que de faire
 * échouer tout le lot : elles resteront dans la file pour quelqu'un d'autre.
 */
export function confirmerEnLot(db: Db, declarationIds: string[], decideurId: string) {
  const confirmees: string[] = []
  const ignorees: Array<{ id: string, raison: string }> = []

  for (const id of declarationIds) {
    try {
      const resultat = confirmerDeclaration(db, id, decideurId)
      if (resultat.dejaDecidee) ignorees.push({ id, raison: 'deja_decidee' })
      else confirmees.push(id)
    }
    catch (e) {
      const statut = (e as { statusCode?: number }).statusCode
      if (statut === 403) ignorees.push({ id, raison: 'propre_declaration' })
      else if (statut === 409) ignorees.push({ id, raison: 'transition_impossible' })
      else throw e
    }
  }

  return { confirmees: confirmees.length, ignorees }
}

function notifierMembre(
  db: Db,
  membershipId: string,
  tontineId: string,
  message: { type: string, title: string, body: string, url: string },
) {
  const [membre] = db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(eq(memberships.id, membershipId))
    .limit(1)
    .all()

  // Un membre géré n'a pas de compte : rien à notifier ici. Il sera joint par
  // SMS, hors périmètre MVP.
  if (membre?.userId) notifier(db, membre.userId, { ...message, tontineId })
}
