import { randomUUID } from 'node:crypto'
import { and, count, eq, inArray } from 'drizzle-orm'
import type { useDb } from '../db/index.ts'
import {
  memberships, rounds, shares, tontineChannels, tontines,
} from '../db/schema.ts'
import { apiError } from '../utils/errors.ts'
import { assertTransition } from '../utils/transitions.ts'
import { canauxDeTontine, rattacherCanal } from './canaux.ts'
import { attribuerParts } from './membres.ts'

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
export function creerBrouillon(db: Db, userId: string, input: {
  name: string
  description?: string
  avatarUrl?: string
  emoji?: string
  locality?: string
  access: 'private' | 'open'
}) {
  const id = randomUUID()

  db.insert(tontines).values({
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
  }).run()

  // Le créateur est président de sa tontine. Le rôle est par tontine.
  const membershipId = randomUUID()
  db.insert(memberships).values({
    id: membershipId,
    tontineId: id,
    userId,
    role: 'president',
    status: 'active',
    joinedAt: new Date(),
  }).run()

  // Et il reçoit une part : l'organisateur d'une tontine y participe. Sans
  // cela il serait membre sans jamais cotiser ni prendre la main, le pot
  // attendu serait sous-évalué, et la phrase d'engagement annoncerait un
  // cycle plus court que la réalité. Il pourra en prendre une seconde.
  attribuerParts(db, id, membershipId, 1)

  return id
}

/** Met à jour un brouillon. Les réglages financiers se figent au démarrage. */
export function majTontine(db: Db, tontineId: string, modifications: Record<string, unknown>) {
  const [tontine] = db.select().from(tontines).where(eq(tontines.id, tontineId)).limit(1).all()
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

  db.update(tontines).set(modifications).where(eq(tontines.id, tontineId)).run()
}

/** Remplace les canaux de collecte rattachés au brouillon. */
export function definirCanaux(db: Db, tontineId: string, channelIds: string[], acteurId: string) {
  db.delete(tontineChannels).where(eq(tontineChannels.tontineId, tontineId)).run()
  for (const channelId of channelIds) {
    rattacherCanal(db, tontineId, channelId, acteurId)
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
export function blocagesPublication(db: Db, tontineId: string): BlocagePublication[] {
  const [tontine] = db.select().from(tontines).where(eq(tontines.id, tontineId)).limit(1).all()
  if (!tontine) throw apiError('NOT_FOUND', 'Tontine introuvable.')

  const blocages: BlocagePublication[] = []

  if (tontine.shareAmount <= 0) {
    blocages.push({ champ: 'shareAmount', message: 'Le montant d’une part n’est pas défini.' })
  }

  if (canauxDeTontine(db, tontineId).length === 0) {
    blocages.push({
      champ: 'collectionChannelIds',
      message: 'Aucun numéro de collecte vérifié n’est rattaché.',
    })
  }

  return blocages
}

/** `draft → open`. Exige un canal vérifié, un montant et une fréquence. */
export function publier(db: Db, tontineId: string) {
  const [tontine] = db.select().from(tontines).where(eq(tontines.id, tontineId)).limit(1).all()
  if (!tontine) throw apiError('NOT_FOUND', 'Tontine introuvable.')

  assertTransition('tontine', tontine.status, 'open')

  const blocages = blocagesPublication(db, tontineId)
  if (blocages.length > 0) {
    throw apiError('FORBIDDEN', blocages[0]!.message, { field: blocages[0]!.champ })
  }

  db.update(tontines).set({ status: 'open' }).where(eq(tontines.id, tontineId)).run()
}

/** Le nombre total de parts d'une tontine — la base de tous les calculs de pot. */
export function totalParts(db: Db, tontineId: string): number {
  const [ligne] = db
    .select({ n: count() })
    .from(shares)
    .where(eq(shares.tontineId, tontineId))
    .all()

  return ligne?.n ?? 0
}

/**
 * Montant attendu d'un tour = `share_amount × total_shares`.
 *
 * Toutes parts confondues, **bénéficiaire inclus** : dans la pratique
 * ivoirienne, celui qui prend la main cotise aussi, et le net lui revient au
 * versement. L'exclure fausserait le pot de tout le monde.
 */
export function potAttendu(db: Db, tontineId: string): number {
  const [tontine] = db.select().from(tontines).where(eq(tontines.id, tontineId)).limit(1).all()
  if (!tontine) throw apiError('NOT_FOUND', 'Tontine introuvable.')

  return tontine.shareAmount * totalParts(db, tontineId)
}

/** Les tontines d'un utilisateur, avec son rôle — assez pour peindre le tableau de bord. */
export function mesTontines(db: Db, userId: string) {
  return db
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
    .all()
}

/** Compte les membres actifs — sert au contrôle de démarrage. */
export function membresActifs(db: Db, tontineId: string): number {
  const [ligne] = db
    .select({ n: count() })
    .from(memberships)
    .where(and(eq(memberships.tontineId, tontineId), eq(memberships.status, 'active')))
    .all()

  return ligne?.n ?? 0
}

/** Le tour courant : le premier qui n'est pas clos. */
export function tourCourant(db: Db, tontineId: string) {
  const [tour] = db
    .select()
    .from(rounds)
    .where(and(eq(rounds.tontineId, tontineId), inArray(rounds.status, ['collecting', 'payout_pending'])))
    .orderBy(rounds.index)
    .limit(1)
    .all()

  return tour ?? null
}
