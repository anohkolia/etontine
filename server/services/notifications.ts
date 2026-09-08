import { randomUUID } from 'node:crypto'
import { and, desc, eq, inArray, isNotNull, isNull, lt } from 'drizzle-orm'
import type { useDb } from '../db/index.ts'
import { memberships, notifications, users } from '../db/schema.ts'

type Db = ReturnType<typeof useDb>

export interface NotificationInput {
  type: string
  title: string
  body: string
  url?: string
  tontineId?: string | null
}

/**
 * Motifs interdits dans une notification.
 *
 * Règle 21 : **aucune notification ne contient de montant**. Elle s'affiche sur
 * un écran verrouillé, et les téléphones se partagent en Côte d'Ivoire —
 * famille, boutique, taxi. « Nouvelle activité sur ta tontine » ne dit rien à
 * qui regarde par-dessus l'épaule ; « Tu as reçu 250 000 FCFA » désigne une
 * cible.
 *
 * La règle est appliquée **ici**, à l'écriture, et pas laissée à la vigilance
 * de chaque appelant : c'est le seul endroit où l'on peut la garantir.
 */
const MOTIFS_INTERDITS = [
  /\bFCFA\b/i,
  /\bXOF\b/i,
  /\bfrancs?\b/i,
  // Un nombre d'au moins quatre chiffres est presque toujours un montant.
  // Les séparateurs sont écrits en points de code : ce sont exactement ceux
  // que produit `useMoney()` — espace fine insécable et espace insécable —
  // et les laisser en littéral rend la ligne indéchiffrable à la relecture.
  /\d[\d\u202F\u00A0.,\s]{3,}\d/,
]

export class NotificationAvecMontantError extends Error {
  constructor(texte: string) {
    super(
      `Notification refusée : « ${texte} » ressemble à un montant. `
      + 'Règle 21 de CLAUDE.md — une notification s’affiche sur un écran verrouillé.',
    )
  }
}

function verifierAbsenceDeMontant(input: NotificationInput): void {
  for (const champ of [input.title, input.body]) {
    for (const motif of MOTIFS_INTERDITS) {
      if (motif.test(champ)) throw new NotificationAvecMontantError(champ)
    }
  }
}

/** Notifie un utilisateur. */
export function notifier(db: Db, userId: string, input: NotificationInput): void {
  verifierAbsenceDeMontant(input)

  db.insert(notifications).values({
    id: randomUUID(),
    userId,
    tontineId: input.tontineId ?? null,
    type: input.type,
    title: input.title,
    body: input.body,
    url: input.url ?? null,
  }).run()
}

/**
 * Notifie **tous les membres actifs** d'une tontine.
 *
 * Les membres gérés — ceux qui n'ont pas encore l'application — n'ont pas de
 * compte à notifier. Ils sont joints par SMS, hors périmètre MVP ; les ignorer
 * ici est délibéré, pas un oubli.
 */
export function notifierTontine(
  db: Db,
  tontineId: string,
  input: NotificationInput,
  options: { sauf?: string[] } = {},
): number {
  const destinataires = db
    .select({ userId: memberships.userId })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(
      eq(memberships.tontineId, tontineId),
      eq(memberships.status, 'active'),
      isNotNull(memberships.userId),
    ))
    .all()

  let envoyees = 0
  for (const d of destinataires) {
    if (!d.userId || options.sauf?.includes(d.userId)) continue
    notifier(db, d.userId, { ...input, tontineId })
    envoyees++
  }
  return envoyees
}

/** Notifications non lues d'un utilisateur. */
export function notificationsNonLues(db: Db, userId: string) {
  return db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
    .all()
}

/**
 * Les notifications d'un utilisateur, de la plus récente à la plus ancienne.
 *
 * Elles s'écrivaient depuis le début et **aucune route ne les rendait** : la
 * table était en écriture seule du point de vue de l'application. Cotisation
 * confirmée, pot versé, numéro de collecte changé, dossier d'identité rejeté —
 * tout y tombait, et rien n'en ressortait. Le push, quand il est configuré,
 * porte la bannière jusqu'au système ; quelqu'un qui l'a ratée, ou dont le
 * navigateur n'en reçoit pas, n'avait aucun recours.
 */
export function mesNotifications(
  db: Db,
  userId: string,
  options: { limit?: number, cursor?: number } = {},
) {
  const limite = Math.min(options.limit ?? 30, 100)

  const conditions = [eq(notifications.userId, userId)]
  if (options.cursor !== undefined) {
    conditions.push(lt(notifications.createdAt, new Date(options.cursor)))
  }

  const lignes = db
    .select()
    .from(notifications)
    .where(and(...conditions))
    .orderBy(desc(notifications.createdAt))
    .limit(limite + 1)
    .all()

  const items = lignes.slice(0, limite)

  return {
    items,
    nextCursor: lignes.length > limite
      ? String(items.at(-1)?.createdAt.getTime() ?? '')
      : null,
    /** Le compteur porte sur **tout**, pas sur la page rendue. */
    unread: notificationsNonLues(db, userId).length,
  }
}

/**
 * Marque des notifications comme lues.
 *
 * Sans identifiants, marque tout : c'est le geste courant — on ouvre l'écran,
 * on a vu. Avec, seulement celles-là, et toujours restreintes à leur
 * destinataire : personne ne marque lues les notifications d'un autre.
 */
export function marquerLues(db: Db, userId: string, ids?: string[]): number {
  const conditions = [eq(notifications.userId, userId), isNull(notifications.readAt)]
  if (ids?.length) conditions.push(inArray(notifications.id, ids))

  const concernees = db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(...conditions))
    .all()

  if (concernees.length === 0) return 0

  db.update(notifications)
    .set({ readAt: new Date() })
    .where(inArray(notifications.id, concernees.map(n => n.id)))
    .run()

  return concernees.length
}
