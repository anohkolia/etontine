import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray } from 'drizzle-orm'
import type { useDb } from '../db/index.ts'
import { disputeMessages, disputes, ledgerEntries, memberships, users } from '../db/schema.ts'
import { apiError } from '../utils/errors.ts'
import { notifier, notifierTontine } from './notifications.ts'

type Db = ReturnType<typeof useDb>

/**
 * Ouvre une contestation sur une écriture du registre.
 *
 * **Depuis n'importe quelle écriture**, et par n'importe quel membre actif.
 * C'est la soupape du système : le registre est append-only, donc rien ne
 * s'efface — la seule façon de dire « ce n'est pas ce qui s'est passé » est de
 * l'écrire à côté, et que tout le monde le voie.
 *
 * Sans cette porte, un membre qui conteste n'a plus qu'un recours : quitter la
 * tontine en accusant le bureau. C'est exactement ce qu'on cherche à éviter.
 */
export function ouvrirContestation(db: Db, ledgerEntryId: string, acteurId: string, message: string) {
  const [ecriture] = db
    .select()
    .from(ledgerEntries)
    .where(eq(ledgerEntries.id, ledgerEntryId))
    .limit(1)
    .all()

  if (!ecriture) throw apiError('NOT_FOUND', 'Écriture introuvable.')

  const disputeId = randomUUID()
  db.insert(disputes).values({
    id: disputeId,
    ledgerEntryId,
    openedBy: acteurId,
    status: 'open',
  }).run()

  db.insert(disputeMessages).values({
    id: randomUUID(),
    disputeId,
    authorId: acteurId,
    body: message.trim(),
  }).run()

  notifierTontine(db, ecriture.tontineId, {
    type: 'contestation_ouverte',
    title: 'Une écriture du registre est contestée',
    body: 'Un membre signale une erreur au registre. Le bureau doit examiner.',
    url: `/app/tontine/${ecriture.tontineId}/registre`,
  })

  return { disputeId }
}

/** La tontine d'une contestation, par l'écriture qu'elle vise. */
function tontineDe(db: Db, litige: typeof disputes.$inferSelect): string {
  const [ecriture] = db
    .select({ tontineId: ledgerEntries.tontineId })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.id, litige.ledgerEntryId))
    .limit(1)
    .all()
  return ecriture!.tontineId
}

/**
 * Ceux qu'une réponse concerne : celui qui a ouvert le fil, et le bureau qui
 * doit trancher — président et censeur. Jamais l'auteur du message lui-même.
 */
function destinatairesDuFil(db: Db, tontineId: string, litige: typeof disputes.$inferSelect, sauf: string): string[] {
  const bureau = db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(
      eq(memberships.tontineId, tontineId),
      eq(memberships.status, 'active'),
      inArray(memberships.role, ['president', 'auditor']),
    ))
    .all()
    .map(m => m.userId)

  return [...new Set([litige.openedBy, ...bureau])].filter((id): id is string => Boolean(id) && id !== sauf)
}

/**
 * Ajoute un message au fil d'une contestation.
 *
 * Celui qui a ouvert le fil et le bureau sont prévenus : sans cela, une
 * réponse restait lettre morte — le membre qui avait signalé une erreur ne
 * savait pas qu'on lui avait répondu, et retournait voir de temps en temps.
 */
export function ajouterMessage(db: Db, disputeId: string, auteurId: string, message: string) {
  const [litige] = db.select().from(disputes).where(eq(disputes.id, disputeId)).limit(1).all()
  if (!litige) throw apiError('NOT_FOUND', 'Contestation introuvable.')

  if (litige.status === 'resolved') {
    throw apiError('INVALID_TRANSITION', 'Cette contestation est close.')
  }

  const id = randomUUID()
  db.insert(disputeMessages).values({ id, disputeId, authorId: auteurId, body: message.trim() }).run()

  const tontineId = tontineDe(db, litige)
  for (const userId of destinatairesDuFil(db, tontineId, litige, auteurId)) {
    notifier(db, userId, {
      type: 'contestation_reponse',
      tontineId,
      title: 'Réponse à une contestation',
      body: 'Quelqu’un a répondu dans le fil d’une erreur signalée au registre.',
      url: `/app/tontine/${tontineId}/registre`,
    })
  }

  return { id }
}

/**
 * Clôt une contestation.
 *
 * La résolution est écrite, pas seulement décidée : le fil reste consultable,
 * et la conclusion avec. Une contestation qu'on clôt sans rien dire laisse le
 * doute exactement là où il était.
 */
export function resoudreContestation(db: Db, disputeId: string, acteurId: string, resolution: string) {
  if (!resolution || resolution.trim().length < 5) {
    throw apiError('VALIDATION_ERROR', 'Explique brièvement la conclusion.', { field: 'resolution' })
  }

  const [litige] = db.select().from(disputes).where(eq(disputes.id, disputeId)).limit(1).all()
  if (!litige) throw apiError('NOT_FOUND', 'Contestation introuvable.')
  if (litige.status === 'resolved') throw apiError('INVALID_TRANSITION', 'Cette contestation est déjà close.')

  db.update(disputes)
    .set({ status: 'resolved', resolvedBy: acteurId, resolvedAt: new Date(), resolution: resolution.trim() })
    .where(eq(disputes.id, disputeId))
    .run()

  // Celui qui a signalé apprend la conclusion : c'est lui qu'elle concerne.
  const tontineId = tontineDe(db, litige)
  if (litige.openedBy !== acteurId) {
    notifier(db, litige.openedBy, {
      type: 'contestation_close',
      tontineId,
      title: 'Ta contestation a été tranchée',
      body: 'Le bureau a écrit sa conclusion sur l’erreur que tu avais signalée.',
      url: `/app/tontine/${tontineId}/registre`,
    })
  }

  return { disputeId, status: 'resolved' as const }
}

/**
 * Les contestations d'une tontine, avec leur fil **et le nom des auteurs**.
 *
 * Un fil anonyme ne vaut rien : dans une contestation, savoir qui affirme quoi
 * est la moitié de l'information. Les identifiants ne disent rien à personne.
 */
export function litigesDe(db: Db, tontineId: string) {
  const fils = db
    .select({ dispute: disputes, entryType: ledgerEntries.type, entryPosition: ledgerEntries.position })
    .from(disputes)
    .innerJoin(ledgerEntries, eq(ledgerEntries.id, disputes.ledgerEntryId))
    .where(eq(ledgerEntries.tontineId, tontineId))
    .all()

  const noms = new Map(
    db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .innerJoin(memberships, eq(memberships.userId, users.id))
      .where(eq(memberships.tontineId, tontineId))
      .all()
      .map(u => [u.id, [u.firstName, u.lastName].filter(Boolean).join(' ') || 'Membre'] as const),
  )

  return fils.map(f => ({
    ...f,
    messages: db
      .select()
      .from(disputeMessages)
      .where(eq(disputeMessages.disputeId, f.dispute.id))
      .orderBy(asc(disputeMessages.createdAt))
      .all()
      .map(m => ({ ...m, auteur: noms.get(m.authorId) ?? 'Membre' })),
  }))
}
