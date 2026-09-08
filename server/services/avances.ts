import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { useDb } from '../db/index.ts'
import { advances, memberships, rounds, users } from '../db/schema.ts'
import { apiError } from '../utils/errors.ts'
import { notifier } from './notifications.ts'

type Db = ReturnType<typeof useDb>

/**
 * Un membre avance la cotisation d'un autre.
 *
 * Cas très fréquent, et souvent invisible dans les carnets papier : quelqu'un
 * dépanne un proche, et la dette se règle plus tard, de la main à la main. La
 * consigner ne change rien au pot — la cotisation reste celle du membre
 * concerné — mais elle évite la dispute classique du « je t'avais avancé ton
 * tour de mars ».
 *
 * L'avance n'est **pas** un paiement : elle ne modifie aucune cotisation. C'est
 * une reconnaissance de dette entre deux membres, tenue à part.
 */
export function enregistrerAvance(db: Db, input: {
  roundId: string
  fromMembershipId: string
  toMembershipId: string
  amount: number
}) {
  if (input.fromMembershipId === input.toMembershipId) {
    throw apiError('VALIDATION_ERROR', 'Un membre ne peut pas avancer pour lui-même.', {
      field: 'toMembershipId',
    })
  }

  const [tour] = db.select().from(rounds).where(eq(rounds.id, input.roundId)).limit(1).all()
  if (!tour) throw apiError('NOT_FOUND', 'Tour introuvable.')

  for (const id of [input.fromMembershipId, input.toMembershipId]) {
    const [m] = db.select().from(memberships).where(eq(memberships.id, id)).limit(1).all()
    if (!m || m.tontineId !== tour.tontineId) {
      throw apiError('VALIDATION_ERROR', 'Membre inconnu dans cette tontine.', { field: 'membershipId' })
    }
  }

  const id = randomUUID()
  db.insert(advances).values({
    id,
    roundId: input.roundId,
    fromMembershipId: input.fromMembershipId,
    toMembershipId: input.toMembershipId,
    amount: input.amount,
  }).run()

  const [beneficiaire] = db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(eq(memberships.id, input.toMembershipId))
    .limit(1)
    .all()

  if (beneficiaire?.userId) {
    notifier(db, beneficiaire.userId, {
      type: 'avance_enregistree',
      tontineId: tour.tontineId,
      title: 'Une avance a été enregistrée à ton nom',
      body: 'Un membre a avancé ta cotisation. Le détail est dans l’application.',
      url: `/app/tontine/${tour.tontineId}/impayes`,
    })
  }

  return { id }
}

/** Solde une avance : la dette entre les deux membres est réglée. */
export function solderAvance(db: Db, avanceId: string) {
  const [avance] = db.select().from(advances).where(eq(advances.id, avanceId)).limit(1).all()
  if (!avance) throw apiError('NOT_FOUND', 'Avance introuvable.')
  if (avance.settledAt) throw apiError('INVALID_TRANSITION', 'Cette avance est déjà soldée.')

  db.update(advances).set({ settledAt: new Date() }).where(eq(advances.id, avanceId)).run()
  return { id: avanceId, settled: true }
}

/**
 * Les avances d'une tontine, avec le nom des deux membres.
 *
 * Une avance sans noms ne dit rien : « 25 000 F, tour 3 » ne règle aucune
 * dispute. Ce qu'on vient y chercher, c'est **qui** a dépanné **qui**.
 */
export function avancesDe(db: Db, tontineId: string) {
  const noms = new Map(
    db
      .select({
        id: memberships.id,
        managedName: memberships.managedName,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(memberships)
      .leftJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.tontineId, tontineId))
      .all()
      .map(m => [
        m.id,
        [m.firstName, m.lastName].filter(Boolean).join(' ') || m.managedName || 'Membre',
      ] as const),
  )

  return db
    .select({ advance: advances, roundIndex: rounds.index })
    .from(advances)
    .innerJoin(rounds, eq(rounds.id, advances.roundId))
    .where(eq(rounds.tontineId, tontineId))
    .all()
    .map(a => ({
      ...a,
      nomPreteur: noms.get(a.advance.fromMembershipId) ?? 'Membre',
      nomBeneficiaire: noms.get(a.advance.toMembershipId) ?? 'Membre',
    }))
}
