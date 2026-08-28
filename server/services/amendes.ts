import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import type { useDb } from '../db/index.ts'
import { contributions, memberships, penalties, rounds, tontines } from '../db/schema.ts'
import { apiError } from '../utils/errors.ts'
import { appendLedger } from './ledger.ts'
import { notifier } from './notifications.ts'

type Db = ReturnType<typeof useDb>

export interface ReglesAmende {
  penaltyAmount: number
  penaltyPeriod: 'once' | 'per_day'
  penaltyCap: number | null
  graceDays: number
}

/**
 * Calcule le montant d'une amende de retard.
 *
 * Deux régimes, et le second est le piège :
 *
 * - `once` : un montant fixe, dû dès que le délai de grâce est dépassé. Simple,
 *   prévisible, c'est ce que pratiquent la plupart des tontines.
 * - `per_day` : `montant × jours de retard`, **plafonné**. Sans plafond, une
 *   amende journalière dépasse la cotisation elle-même en quelques semaines et
 *   devient une dette impossible à solder — c'est ainsi qu'un membre en
 *   difficulté passagère se retrouve exclu de fait. Le schéma Zod impose donc
 *   un plafond dès qu'on choisit ce régime.
 *
 * Les jours de retard se comptent **après** le délai de grâce, pas depuis
 * l'échéance : sinon la grâce ne servirait à rien.
 *
 * Le résultat est un entier de FCFA (règle 6).
 */
export function calculerAmende(
  regles: ReglesAmende,
  dueDate: string,
  aujourdhui: Date = new Date(),
): number {
  if (regles.penaltyAmount <= 0) return 0

  const echeance = new Date(`${dueDate}T00:00:00Z`)
  const finDeGrace = new Date(echeance.getTime() + regles.graceDays * 86_400_000)
  const jour = new Date(Date.UTC(
    aujourdhui.getUTCFullYear(), aujourdhui.getUTCMonth(), aujourdhui.getUTCDate(),
  ))

  const joursDeRetard = Math.floor((jour.getTime() - finDeGrace.getTime()) / 86_400_000)
  if (joursDeRetard <= 0) return 0

  if (regles.penaltyPeriod === 'once') return regles.penaltyAmount

  const brut = regles.penaltyAmount * joursDeRetard
  return regles.penaltyCap !== null && regles.penaltyCap > 0
    ? Math.min(brut, regles.penaltyCap)
    : brut
}

/** Les règles d'amende d'une tontine. */
export function reglesDe(db: Db, tontineId: string): ReglesAmende {
  const [t] = db.select().from(tontines).where(eq(tontines.id, tontineId)).limit(1).all()
  if (!t) throw apiError('NOT_FOUND', 'Tontine introuvable.')

  return {
    penaltyAmount: t.penaltyAmount,
    penaltyPeriod: t.penaltyPeriod,
    penaltyCap: t.penaltyCap,
    graceDays: t.graceDays,
  }
}

/**
 * Applique une amende. **Jamais automatiquement.**
 *
 * Le calcul est fait par la machine, la décision par le président
 * (docs/data-model.md §5). Une amende qui tombe toute seule sur quelqu'un dont
 * la moto est en panne, c'est la tontine qui perd un membre — alors que le
 * bureau, lui, sait faire la différence entre un retard et un abandon.
 *
 * Le montant est **fourni par l'appelant** et non recalculé ici : le président
 * peut décider d'appliquer moins que le barème.
 */
export function appliquerAmende(
  db: Db,
  contributionId: string,
  presidentId: string,
  montant: number,
  motif?: string,
) {
  const [ligne] = db
    .select({
      contribution: contributions,
      tontineId: rounds.tontineId,
      roundId: rounds.id,
      membershipId: contributions.membershipId,
    })
    .from(contributions)
    .innerJoin(rounds, eq(rounds.id, contributions.roundId))
    .where(eq(contributions.id, contributionId))
    .limit(1)
    .all()

  if (!ligne) throw apiError('NOT_FOUND', 'Cotisation introuvable.')

  if (montant <= 0) {
    throw apiError('VALIDATION_ERROR', 'Le montant de l’amende doit être positif.', { field: 'amount' })
  }

  const dejaAppliquee = db
    .select()
    .from(penalties)
    .where(and(eq(penalties.contributionId, contributionId), eq(penalties.status, 'applied')))
    .all()

  if (dejaAppliquee.length > 0) {
    throw apiError('INVALID_TRANSITION', 'Une amende est déjà appliquée sur cette cotisation.')
  }

  const penaltyId = randomUUID()
  db.insert(penalties).values({
    id: penaltyId,
    contributionId,
    amount: montant,
    status: 'applied',
    reason: motif ?? null,
    appliedBy: presidentId,
  }).run()

  appendLedger(db, {
    tontineId: ligne.tontineId,
    roundId: ligne.roundId,
    type: 'penalty_applied',
    actorId: presidentId,
    payload: { penaltyId, contributionId, amount: montant, reason: motif ?? null },
  })

  const [membre] = db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(eq(memberships.id, ligne.membershipId))
    .limit(1)
    .all()

  if (membre?.userId) {
    // Aucun montant dans la notification (règle 21).
    notifier(db, membre.userId, {
      type: 'amende_appliquee',
      tontineId: ligne.tontineId,
      title: 'Une amende de retard a été appliquée',
      body: 'Le président a appliqué une amende sur ta cotisation. Ouvre l’application pour la voir.',
      url: `/app/tontine/${ligne.tontineId}/impayes`,
    })
  }

  return { penaltyId, amount: montant }
}

/**
 * Annule une amende. **Le motif est obligatoire.**
 *
 * Une amende qui disparaît sans explication est pire que pas d'amende du tout :
 * c'est ce qui fait dire que « le bureau arrange ses amis ». Le motif part au
 * registre, lisible par tout le groupe.
 */
export function annulerAmende(db: Db, penaltyId: string, acteurId: string, motif: string) {
  if (!motif || motif.trim().length < 5) {
    throw apiError('VALIDATION_ERROR', 'Explique brièvement pourquoi l’amende est annulée.', { field: 'reason' })
  }

  const [amende] = db.select().from(penalties).where(eq(penalties.id, penaltyId)).limit(1).all()
  if (!amende) throw apiError('NOT_FOUND', 'Amende introuvable.')

  if (amende.status === 'waived') {
    throw apiError('INVALID_TRANSITION', 'Cette amende est déjà annulée.')
  }

  const [ligne] = db
    .select({ tontineId: rounds.tontineId, roundId: rounds.id })
    .from(contributions)
    .innerJoin(rounds, eq(rounds.id, contributions.roundId))
    .where(eq(contributions.id, amende.contributionId))
    .limit(1)
    .all()

  db.update(penalties)
    .set({ status: 'waived', waivedBy: acteurId, waiveReason: motif.trim() })
    .where(eq(penalties.id, penaltyId))
    .run()

  appendLedger(db, {
    tontineId: ligne!.tontineId,
    roundId: ligne!.roundId,
    type: 'penalty_waived',
    actorId: acteurId,
    payload: { penaltyId, amount: amende.amount, reason: motif.trim() },
  })

  return { penaltyId, status: 'waived' as const }
}

/** Les amendes d'une tontine, appliquées comme annulées. */
export function amendesDe(db: Db, tontineId: string) {
  return db
    .select({
      penalty: penalties,
      contributionId: contributions.id,
      roundIndex: rounds.index,
      membershipId: contributions.membershipId,
      managedName: memberships.managedName,
    })
    .from(penalties)
    .innerJoin(contributions, eq(contributions.id, penalties.contributionId))
    .innerJoin(rounds, eq(rounds.id, contributions.roundId))
    .innerJoin(memberships, eq(memberships.id, contributions.membershipId))
    .where(eq(rounds.tontineId, tontineId))
    .all()
}
