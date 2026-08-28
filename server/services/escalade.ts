import { and, eq, isNull, lt } from 'drizzle-orm'
import type { useDb } from '../db/index.ts'
import {
  contributions, memberships, paymentDeclarations, rounds,
} from '../db/schema.ts'
import { appendLedger } from './ledger.ts'
import { notifier, notifierTontine } from './notifications.ts'

type Db = ReturnType<typeof useDb>

/** Délai au-delà duquel une déclaration en attente est escaladée. */
export const ESCALADE_HEURES = 48

/** Délai au-delà duquel un versement en espèces non reconnu est signalé. */
export const ESPECES_NON_CONFIRMEES_HEURES = 72

/**
 * Escalade les déclarations laissées sans décision depuis plus de 48 heures.
 *
 * Le silence du trésorier est le premier symptôme d'une tontine qui se grippe :
 * le membre a envoyé son argent, il ne se passe rien, et il commence à douter.
 * L'escalade rend ce silence **visible de tous au registre** plutôt que de le
 * laisser entre le membre et le bureau. C'est le point : le registre est ce qui
 * remplace la parole donnée, et un blocage qui n'y figure pas n'existe pas.
 *
 * Idempotente : une déclaration déjà escaladée n'est pas retraitée.
 */
export function escaladerDeclarations(db: Db, maintenant: Date = new Date()): number {
  const limite = new Date(maintenant.getTime() - ESCALADE_HEURES * 3_600_000)

  const enSouffrance = db
    .select({
      declaration: paymentDeclarations,
      contributionId: contributions.id,
      tontineId: rounds.tontineId,
      roundId: rounds.id,
      membershipId: contributions.membershipId,
    })
    .from(paymentDeclarations)
    .innerJoin(contributions, eq(contributions.id, paymentDeclarations.contributionId))
    .innerJoin(rounds, eq(rounds.id, contributions.roundId))
    .where(and(
      eq(paymentDeclarations.decision, 'pending'),
      isNull(paymentDeclarations.escalatedAt),
      lt(paymentDeclarations.declaredAt, limite),
    ))
    .all()

  for (const ligne of enSouffrance) {
    db.update(paymentDeclarations)
      .set({ escalatedAt: maintenant })
      .where(eq(paymentDeclarations.id, ligne.declaration.id))
      .run()

    // Écriture au registre : l'alerte devient consultable par **tout** membre
    // actif, pas seulement par le bureau.
    appendLedger(db, {
      tontineId: ligne.tontineId,
      roundId: ligne.roundId,
      type: 'declaration_escalated',
      // L'auteur de la déclaration est l'acteur : c'est son envoi qui attend.
      actorId: ligne.declaration.declaredBy,
      payload: {
        declarationId: ligne.declaration.id,
        contributionId: ligne.contributionId,
        declaredAt: ligne.declaration.declaredAt.toISOString(),
        heuresDAttente: ESCALADE_HEURES,
      },
    })

    notifierTontine(db, ligne.tontineId, {
      type: 'declaration_escaladee',
      title: 'Une déclaration attend depuis deux jours',
      body: 'Une cotisation déclarée n’a toujours pas été confirmée. Elle est signalée au registre.',
      url: `/app/tontine/${ligne.tontineId}/confirmations`,
    })
  }

  return enSouffrance.length
}

/**
 * Signale les versements en espèces qu'aucun membre n'a reconnus après 72 h.
 *
 * Quand le trésorier déclare des espèces pour un tiers, c'est le tiers qui doit
 * reconnaître le versement — sinon le bureau pourrait porter au registre des
 * versements qui n'ont jamais eu lieu. Passé trois jours sans réponse, on ne
 * conclut pas à la fraude : on **signale**, et le registre en garde la trace.
 * La différence compte : accuser à tort casse une tontine aussi sûrement que
 * voler dedans.
 */
export function signalerEspecesNonConfirmees(db: Db, maintenant: Date = new Date()): number {
  const limite = new Date(maintenant.getTime() - ESPECES_NON_CONFIRMEES_HEURES * 3_600_000)

  const sansReponse = db
    .select({
      declaration: paymentDeclarations,
      contributionId: contributions.id,
      tontineId: rounds.tontineId,
      roundId: rounds.id,
      membershipId: contributions.membershipId,
    })
    .from(paymentDeclarations)
    .innerJoin(contributions, eq(contributions.id, paymentDeclarations.contributionId))
    .innerJoin(rounds, eq(rounds.id, contributions.roundId))
    .where(and(
      eq(paymentDeclarations.source, 'treasurer'),
      eq(paymentDeclarations.channel, 'cash'),
      isNull(paymentDeclarations.memberAcknowledgedAt),
      isNull(paymentDeclarations.unconfirmedFlaggedAt),
      lt(paymentDeclarations.declaredAt, limite),
    ))
    .all()

  for (const ligne of sansReponse) {
    db.update(paymentDeclarations)
      .set({ unconfirmedFlaggedAt: maintenant })
      .where(eq(paymentDeclarations.id, ligne.declaration.id))
      .run()

    appendLedger(db, {
      tontineId: ligne.tontineId,
      roundId: ligne.roundId,
      type: 'cash_unconfirmed',
      actorId: ligne.declaration.declaredBy,
      payload: {
        declarationId: ligne.declaration.id,
        contributionId: ligne.contributionId,
        heuresSansReponse: ESPECES_NON_CONFIRMEES_HEURES,
      },
    })

    const [membre] = db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(eq(memberships.id, ligne.membershipId))
      .limit(1)
      .all()

    if (membre?.userId) {
      notifier(db, membre.userId, {
        type: 'especes_non_confirmees',
        tontineId: ligne.tontineId,
        title: 'Un versement attend ta confirmation',
        body: 'Un versement en espèces enregistré à ton nom n’a pas été reconnu. Ouvre l’application.',
        url: `/app/tontine/${ligne.tontineId}/cotiser`,
      })
    }
  }

  return sansReponse.length
}

/**
 * Confirmation inverse : le membre reconnaît un versement enregistré pour lui.
 *
 * C'est la contrepartie de la déclaration d'espèces par le trésorier. Le membre
 * n'a pas envoyé lui-même ; il doit pouvoir dire s'il reconnaît le versement.
 */
export function reconnaitreVersement(db: Db, declarationId: string, membreUserId: string) {
  const [ligne] = db
    .select({
      declaration: paymentDeclarations,
      tontineId: rounds.tontineId,
      membershipUserId: memberships.userId,
    })
    .from(paymentDeclarations)
    .innerJoin(contributions, eq(contributions.id, paymentDeclarations.contributionId))
    .innerJoin(rounds, eq(rounds.id, contributions.roundId))
    .innerJoin(memberships, eq(memberships.id, contributions.membershipId))
    .where(eq(paymentDeclarations.id, declarationId))
    .limit(1)
    .all()

  if (!ligne) return { ok: false as const, raison: 'introuvable' }
  if (ligne.membershipUserId !== membreUserId) return { ok: false as const, raison: 'pas_le_sien' }

  db.update(paymentDeclarations)
    .set({ memberAcknowledgedAt: new Date() })
    .where(eq(paymentDeclarations.id, declarationId))
    .run()

  return { ok: true as const }
}
