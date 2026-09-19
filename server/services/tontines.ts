import { randomUUID } from 'node:crypto'
import { and, count, eq, inArray } from 'drizzle-orm'
import type { useDb } from '../db/index.ts'
import {
  memberships, rounds, shares, tontineChannels, tontines,
} from '../db/schema.ts'
import { apiError } from '../utils/errors.ts'
import { assertTransition } from '../utils/transitions.ts'
import { canauxDeTontine, rattacherCanal } from './canaux.ts'
import { appendLedger } from './ledger.ts'
import { notifierTontine } from './notifications.ts'

type Db = ReturnType<typeof useDb>

/** Nombre minimal de membres actifs pour démarrer (docs/data-model.md §2.1). */
export const MEMBRES_MINIMUM = 3

/**
 * Crée un brouillon de tontine.
 *
 * Le brouillon vit **côté serveur** dès la première étape du wizard. Le garder
 * seulement dans le navigateur reviendrait à perdre une demi-heure de saisie au
 * premier onglet fermé — et à faire du client la source de vérité sur des
 * réglages financiers, ce que la règle 12 interdit.
 */
export async function creerBrouillon(db: Db, userId: string, input: {
  name: string
  description?: string
  avatarUrl?: string
  emoji?: string
  locality?: string
  access: 'private' | 'open'
}) {
  const id = randomUUID()

  await db.insert(tontines).values({
    id,
    name: input.name,
    description: input.description ?? null,
    avatarUrl: input.avatarUrl ?? null,
    emoji: input.emoji ?? null,
    locality: input.locality ?? null,
    access: input.access,
    // Valeurs de départ neutres : l'étape « Argent » les remplacera. Un montant
    // à zéro est un brouillon incomplet, jamais une tontine gratuite.
    shareAmount: 0,
    frequency: 'monthly',
    startDate: new Date().toISOString().slice(0, 10),
    status: 'draft',
    createdBy: userId,
  })

  // Le créateur est président de sa tontine. Le rôle est par tontine.
  //
  // Il ne reçoit **pas** de part : le président ne cotise pas. Il tient le
  // canal de collecte, confirme les cotisations des autres et verse le pot —
  // il ne peut pas être en même temps celui qu'on vérifie. S'il veut
  // participer, il rejoint avec un compte membre, comme n'importe qui.
  await db.insert(memberships).values({
    id: randomUUID(),
    tontineId: id,
    userId,
    role: 'president',
    status: 'active',
    joinedAt: new Date(),
  })

  return id
}

/** Met à jour un brouillon. Les réglages financiers se figent au démarrage. */
export async function majTontine(db: Db, tontineId: string, modifications: Record<string, unknown>) {
  const [tontine] = await db.select().from(tontines).where(eq(tontines.id, tontineId)).limit(1)
  if (!tontine) throw apiError('NOT_FOUND', 'Tontine introuvable.')

  if (tontine.status === 'running') {
    // Une fois la tontine lancée, seuls les champs de présentation bougent :
    // changer un montant en cours de route réécrirait des dus déjà calculés.
    // L'icône est de la présentation pure : la changer sur une tontine en
    // cours ne touche aucun montant ni aucun statut.
    const autorises = new Set(['description', 'avatarUrl', 'emoji', 'locality'])
    const interdits = Object.keys(modifications).filter(k => !autorises.has(k))

    if (interdits.length > 0) {
      throw apiError(
        'FORBIDDEN',
        'Les réglages d’une tontine en cours ne peuvent plus être modifiés.',
        { field: interdits[0] },
      )
    }
  }

  await db.update(tontines).set(modifications).where(eq(tontines.id, tontineId))
}

/**
 * Remplace les canaux de collecte rattachés à une tontine.
 *
 * **On rattache avant de retirer, et l'ordre est la règle 22 elle-même.**
 * `rattacherCanal` reconnaît un changement de numéro en regardant ce qui est
 * déjà rattaché : c'est ce constat qui déclenche le gel de 48 h, l'écriture au
 * registre et la notification à tous les membres. Vider la table d'abord lui
 * faisait voir un premier rattachement sur une tontine en cours — et les trois
 * sautaient en silence. La règle était écrite, testée sur `rattacherCanal`, et
 * inatteignable par le seul chemin qui existe : l'écran de réglages.
 */
export async function definirCanaux(db: Db, tontineId: string, channelIds: string[], acteurId: string) {
  const actuels = await db
    .select()
    .from(tontineChannels)
    .where(eq(tontineChannels.tontineId, tontineId))

  const dejaLa = new Set(actuels.map(c => c.channelId))

  for (const channelId of channelIds) {
    // Re-poser un canal déjà rattaché heurterait la clé primaire, et surtout
    // remettrait un gel de 48 h sur un numéro qui n'a pas bougé.
    if (!dejaLa.has(channelId)) await rattacherCanal(db, tontineId, channelId, acteurId)
  }

  const aRetirer = actuels
    .filter(c => !channelIds.includes(c.channelId))
    .map(c => c.channelId)

  if (aRetirer.length > 0) {
    await db.delete(tontineChannels)
      .where(and(
        eq(tontineChannels.tontineId, tontineId),
        inArray(tontineChannels.channelId, aRetirer),
      ))
  }
}

export interface BlocagePublication {
  champ: string
  message: string
}

/**
 * Ce qui manque pour publier un brouillon.
 *
 * Renvoyer la liste plutôt qu'un simple refus : l'organisateur voit d'un coup
 * ce qu'il lui reste à faire, au lieu de découvrir les manques un par un.
 */
export async function blocagesPublication(db: Db, tontineId: string): Promise<BlocagePublication[]> {
  const [tontine] = await db.select().from(tontines).where(eq(tontines.id, tontineId)).limit(1)
  if (!tontine) throw apiError('NOT_FOUND', 'Tontine introuvable.')

  const blocages: BlocagePublication[] = []

  if (tontine.shareAmount <= 0) {
    blocages.push({ champ: 'shareAmount', message: 'Le montant d’une part n’est pas défini.' })
  }

  if ((await canauxDeTontine(db, tontineId)).length === 0) {
    blocages.push({
      champ: 'collectionChannelIds',
      message: 'Aucun numéro de collecte vérifié n’est rattaché.',
    })
  }

  return blocages
}

/** `draft → open`. Exige un canal vérifié, un montant et une fréquence. */
export async function publier(db: Db, tontineId: string) {
  const [tontine] = await db.select().from(tontines).where(eq(tontines.id, tontineId)).limit(1)
  if (!tontine) throw apiError('NOT_FOUND', 'Tontine introuvable.')

  assertTransition('tontine', tontine.status, 'open')

  const blocages = await blocagesPublication(db, tontineId)
  if (blocages.length > 0) {
    throw apiError('FORBIDDEN', blocages[0]!.message, { field: blocages[0]!.champ })
  }

  await db.update(tontines).set({ status: 'open' }).where(eq(tontines.id, tontineId))
}

/** Le nombre total de parts d'une tontine — la base de tous les calculs de pot. */
export async function totalParts(db: Db, tontineId: string): Promise<number> {
  const [ligne] = await db
    .select({ n: count() })
    .from(shares)
    .where(eq(shares.tontineId, tontineId))

  return ligne?.n ?? 0
}

/**
 * Montant attendu d'un tour = `share_amount × total_shares`.
 *
 * Toutes parts confondues, **bénéficiaire inclus** : dans la pratique
 * ivoirienne, celui qui prend la main cotise aussi, et le net lui revient au
 * versement. L'exclure fausserait le pot de tout le monde.
 */
export async function potAttendu(db: Db, tontineId: string): Promise<number> {
  const [tontine] = await db.select().from(tontines).where(eq(tontines.id, tontineId)).limit(1)
  if (!tontine) throw apiError('NOT_FOUND', 'Tontine introuvable.')

  return tontine.shareAmount * (await totalParts(db, tontineId))
}

/** Les tontines d'un utilisateur, avec son rôle — assez pour peindre le tableau de bord. */
export async function mesTontines(db: Db, userId: string) {
  return await db
    .select({
      id: tontines.id,
      name: tontines.name,
      emoji: tontines.emoji,
      locality: tontines.locality,
      status: tontines.status,
      shareAmount: tontines.shareAmount,
      frequency: tontines.frequency,
      myRole: memberships.role,
      membershipStatus: memberships.status,
    })
    .from(memberships)
    .innerJoin(tontines, eq(tontines.id, memberships.tontineId))
    .where(and(
      eq(memberships.userId, userId),
      inArray(memberships.status, ['active', 'pending_approval', 'invited']),
    ))
}

/** Compte les membres actifs — sert au contrôle de démarrage. */
export async function membresActifs(db: Db, tontineId: string): Promise<number> {
  const [ligne] = await db
    .select({ n: count() })
    .from(memberships)
    .where(and(eq(memberships.tontineId, tontineId), eq(memberships.status, 'active')))

  return ligne?.n ?? 0
}

/** Le tour courant : le premier qui n'est pas clos. */
export async function tourCourant(db: Db, tontineId: string) {
  const [tour] = await db
    .select()
    .from(rounds)
    .where(and(eq(rounds.tontineId, tontineId), inArray(rounds.status, ['collecting', 'payout_pending'])))
    .orderBy(rounds.index)
    .limit(1)

  return tour ?? null
}

/**
 * Annule une tontine publiée qui n'a pas démarré : `open → archived`.
 *
 * Une tontine publiée qui ne démarre jamais — le groupe ne s'est pas réuni,
 * le président a changé d'avis — restait `open` pour toujours, et avec elle
 * une place comptée au quota d'abonnement. Aucune route ne la fermait.
 *
 * Rien n'a été cotisé, rien n'est dû : il n'y a pas de tour. L'annulation
 * s'écrit au registre avec son motif, et chaque membre est prévenu — quelqu'un
 * qui attendait le démarrage doit savoir qu'il n'aura pas lieu. Une tontine en
 * cours ne s'annule pas : elle va au bout de son cycle, la table d'états le
 * garantit.
 */
export async function annulerTontine(db: Db, tontineId: string, acteurId: string, motif: string) {
  const [tontine] = await db.select().from(tontines).where(eq(tontines.id, tontineId)).limit(1)
  if (!tontine) throw apiError('NOT_FOUND', 'Tontine introuvable.')

  if (tontine.status === 'draft') {
    throw apiError('INVALID_TRANSITION', 'Un brouillon ne s’annule pas : il se supprime.', { field: 'status' })
  }
  assertTransition('tontine', tontine.status, 'archived')

  if (tontine.status !== 'open') {
    throw apiError('INVALID_TRANSITION', 'Seule une tontine publiée et non démarrée peut être annulée.', { field: 'status' })
  }

  await db.update(tontines).set({ status: 'archived' }).where(eq(tontines.id, tontineId))

  await appendLedger(db, {
    tontineId,
    type: 'settings_changed',
    actorId: acteurId,
    payload: { changement: 'annulation', motif },
  })

  // Le nom de la tontine n'entre pas dans le texte : un nom peut contenir un
  // nombre, et la garde de la règle 21 le prendrait pour un montant.
  await notifierTontine(db, tontineId, {
    type: 'tontine_annulee',
    title: 'Tontine annulée',
    body: 'Une tontine que tu avais rejointe a été annulée avant son démarrage. Rien n’était dû.',
    url: '/app',
  }, { sauf: [acteurId] })
}

/**
 * Archive une tontine terminée : `closed → archived`.
 *
 * Le cycle est fini, chacun a pris la main. Archiver la sort du tableau de
 * bord — pas du registre, qui reste lisible et exportable — pour que la liste
 * ne s'allonge pas d'année en année. Le geste est du président, et il s'écrit.
 */
export async function archiverTontine(db: Db, tontineId: string, acteurId: string) {
  const [tontine] = await db.select().from(tontines).where(eq(tontines.id, tontineId)).limit(1)
  if (!tontine) throw apiError('NOT_FOUND', 'Tontine introuvable.')

  if (tontine.status !== 'closed') {
    throw apiError('INVALID_TRANSITION', 'Seule une tontine terminée peut être archivée.', { field: 'status' })
  }
  assertTransition('tontine', tontine.status, 'archived')

  await db.update(tontines).set({ status: 'archived' }).where(eq(tontines.id, tontineId))

  await appendLedger(db, {
    tontineId,
    type: 'settings_changed',
    actorId: acteurId,
    payload: { changement: 'archivage' },
  })
}

/**
 * Supprime un brouillon.
 *
 * Un brouillon n'a ni tour, ni cotisation, ni écriture au registre qui vaille :
 * il n'existe que pour son auteur. Le garder « archivé » encombrerait la base
 * de tontines qui n'ont jamais existé pour personne. Les clés étrangères sont
 * en cascade : adhésions, parts et rattachements de canaux partent avec lui.
 *
 * Tout autre état est refusé : dès qu'une tontine est publiée, d'autres
 * personnes la voient, et sa fin doit s'écrire — c'est `annulerTontine`.
 */
export async function supprimerBrouillon(db: Db, tontineId: string) {
  const [tontine] = await db.select().from(tontines).where(eq(tontines.id, tontineId)).limit(1)
  if (!tontine) throw apiError('NOT_FOUND', 'Tontine introuvable.')

  if (tontine.status !== 'draft') {
    throw apiError(
      'INVALID_TRANSITION',
      'Seul un brouillon se supprime. Une tontine publiée s’annule, une tontine terminée s’archive.',
      { field: 'status' },
    )
  }

  await db.delete(tontines).where(eq(tontines.id, tontineId))
}
