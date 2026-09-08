import { and, asc, eq, inArray } from 'drizzle-orm'
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
 * Qui peut confirmer une déclaration faite par `declarantId`.
 *
 * Les adhésions actives de rôle président ou trésorier qui ont un compte,
 * **moins le déclarant lui-même** — puisque c'est précisément lui que la règle
 * de séparation écarte.
 *
 * Cette liste existe pour une raison : sur une tontine où l'organisateur cumule
 * tous les rôles, elle est vide, et la règle §2.4 n'a alors plus personne à qui
 * confier la décision. Le savoir permet de traiter ce cas sans le confondre
 * avec une tentative d'auto-validation dans un bureau qui, lui, a du monde.
 */
export function confirmateursPossibles(db: Db, tontineId: string, declarantId: string): string[] {
  return db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(
      eq(memberships.tontineId, tontineId),
      eq(memberships.status, 'active'),
      inArray(memberships.role, ['president', 'treasurer']),
    ))
    .all()
    .map(m => m.userId)
    .filter((id): id is string => id !== null && id !== declarantId)
}

/**
 * Confirme une déclaration.
 *
 * **Règle de séparation, vérifiée côté serveur** (docs/data-model.md §2.4) :
 * `declared_by ≠ decided_by`. Personne ne valide sa propre déclaration, pas
 * même le trésorier pour sa propre cotisation. C'est le contrôle qui empêche un
 * organisateur de se déclarer à jour tout seul, et il n'a de valeur que s'il
 * est appliqué ici — masquer un bouton côté client n'empêche rien.
 *
 * **Le seul repli : le bureau d'une seule personne.** Quand l'organisateur
 * cumule les rôles, la règle n'a personne à qui confier la décision, et sa
 * propre cotisation resterait bloquée en « déclarée » à chaque tour. Elle est
 * alors confirmée d'office et le registre le dit — parce qu'il n'y a de toute
 * façon rien à vérifier : l'argent que l'organisateur cotise part sur son
 * propre canal de collecte, aucun tiers ne le voit passer. Le contrôle réel
 * est en aval, à l'accusé de réception du bénéficiaire, qui lui reste réservé.
 */
export function confirmerDeclaration(db: Db, declarationId: string, decideurId: string) {
  const { declaration, contribution, tontineId, roundId, membershipId } = contexte(db, declarationId)

  if (declaration.decision !== 'pending') {
    // Déjà décidée : ce n'est pas une erreur, c'est un rejeu. On le dit sans
    // rien changer — c'est ce qui rend « tout confirmer » idempotent.
    return { declarationId, dejaDecidee: true, autoConfirmee: false, contributionStatus: contribution.status }
  }

  // Règle de séparation §2.4 : personne ne décide sur sa propre déclaration.
  // Elle ne cède que lorsqu'il n'y a **personne d'autre** — bureau d'une seule
  // personne — et le repli est alors dérivé des données, jamais d'un drapeau
  // que l'appelant pourrait poser. Dès qu'un second membre de bureau existe, la
  // règle reprend d'elle-même, sans rien à défaire ici.
  let autoConfirmee = false
  if (declaration.declaredBy === decideurId) {
    if (confirmateursPossibles(db, tontineId, decideurId).length > 0) {
      throw apiError(
        'FORBIDDEN',
        'Tu ne peux pas confirmer ta propre déclaration. Un autre membre du bureau doit le faire.',
      )
    }
    autoConfirmee = true
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
      // Écrit **seulement** quand la confirmation n'a été vue par personne :
      // le groupe doit pouvoir distinguer au registre une cotisation validée
      // par un tiers d'une cotisation que son auteur a validée faute de tiers.
      ...(autoConfirmee ? { autoConfirmee: true, motif: 'aucun_second_valideur' } : {}),
    },
  })

  notifierMembre(db, membershipId, tontineId, {
    type: 'cotisation_confirmee',
    title: 'Ta cotisation est confirmée',
    body: 'Le trésorier a confirmé ta cotisation. Elle apparaît au registre.',
    url: `/app/tontine/${tontineId}/registre`,
    // Jamais à soi-même : s'annoncer qu'un trésorier a confirmé, quand on est
    // le trésorier et le cotisant, n'apprend rien à personne.
  }, decideurId)

  return { declarationId, dejaDecidee: false, autoConfirmee, contributionStatus: soldee ? 'confirmed' : 'due' }
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
  saufUserId?: string,
) {
  const [membre] = db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(eq(memberships.id, membershipId))
    .limit(1)
    .all()

  // Un membre géré n'a pas de compte : rien à notifier ici. Il sera joint par
  // SMS, hors périmètre MVP.
  if (membre?.userId && membre.userId !== saufUserId) notifier(db, membre.userId, { ...message, tontineId })
}

/**
 * Rouvre une cotisation contestée, pour que le membre puisse renvoyer.
 *
 * Le rejet exige un motif, et son but est qu'on corrige. Mais `disputed` ne
 * mène qu'à `confirmed` ou `due` (§2.4) : re-déclarer depuis `disputed` est
 * impossible, et **rien n'empruntait le retour vers `due`**. Une déclaration
 * rejetée bloquait donc la cotisation pour de bon — le membre lisait « ta
 * déclaration a été rejetée », et n'avait aucun moyen d'en refaire une.
 *
 * L'acteur est le président ou le censeur, comme le veut §2.4 : rouvrir, c'est
 * constater que la contestation est résolue.
 */
export function rouvrirCotisation(db: Db, contributionId: string, acteurId: string) {
  const [ligne] = db
    .select({ contribution: contributions, tontineId: rounds.tontineId, roundId: rounds.id })
    .from(contributions)
    .innerJoin(rounds, eq(rounds.id, contributions.roundId))
    .where(eq(contributions.id, contributionId))
    .limit(1)
    .all()

  if (!ligne) throw apiError('NOT_FOUND', 'Cotisation introuvable.')

  assertTransition('contribution', ligne.contribution.status, 'due')

  db.update(contributions)
    .set({ status: 'due' })
    .where(eq(contributions.id, contributionId))
    .run()

  appendLedger(db, {
    tontineId: ligne.tontineId,
    roundId: ligne.roundId,
    type: 'settings_changed',
    actorId: acteurId,
    payload: { changement: 'cotisation_rouverte', contributionId },
  })

  notifierMembre(db, ligne.contribution.membershipId, ligne.tontineId, {
    type: 'cotisation_rouverte',
    title: 'Tu peux renvoyer ta cotisation',
    body: 'Le bureau a rouvert ta cotisation. Tu peux déclarer à nouveau.',
    url: `/app/tontine/${ligne.tontineId}/cotiser`,
  }, acteurId)

  return { contributionId, status: 'due' as const }
}
