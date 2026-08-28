import { randomBytes, randomUUID } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import type { useDb } from '../db/index.ts'
import { invites, memberships, shares, tontines, users } from '../db/schema.ts'
import { apiError } from '../utils/errors.ts'
import { appendLedger } from './ledger.ts'

type Db = ReturnType<typeof useDb>

/** Durée de vie d'un lien d'invitation. */
const VALIDITE_JOURS = 30

/** Crée un lien d'invitation. Le jeton est imprévisible, jamais dérivé de l'id. */
export function creerInvitation(db: Db, tontineId: string, createdBy: string, maxUses = 20) {
  const token = randomBytes(16).toString('base64url')
  const expiresAt = new Date(Date.now() + VALIDITE_JOURS * 86_400_000)

  db.insert(invites).values({
    id: randomUUID(),
    token,
    tontineId,
    createdBy,
    expiresAt,
    maxUses,
    usedCount: 0,
  }).run()

  return { token, expiresAt, maxUses }
}

export interface ApercuInvitation {
  tontineId: string
  name: string
  description: string | null
  locality: string | null
  presidentName: string
  shareAmount: number
  frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly'
  memberCount: number
  totalShares: number
  status: string
}

/**
 * Aperçu **public** d'une invitation — consultable sans être connecté.
 *
 * C'est le point d'entrée de tout le produit : quelqu'un reçoit un lien par
 * WhatsApp et doit pouvoir juger avant de créer un compte. Exiger la connexion
 * d'abord ferait perdre la moitié des arrivants, et demanderait de s'inscrire
 * pour découvrir un engagement qu'on refusera peut-être.
 *
 * On expose donc strictement ce qui permet de décider : nom de la tontine,
 * président, montant, fréquence, nombre de membres. **Pas la liste des
 * membres**, pas leurs numéros, pas l'état des cotisations. Un lien qui fuite
 * ne doit pas livrer le carnet d'adresses du groupe.
 */
export function apercuInvitation(db: Db, token: string): ApercuInvitation {
  const [invitation] = db.select().from(invites).where(eq(invites.token, token)).limit(1).all()

  if (!invitation) throw apiError('NOT_FOUND', 'Ce lien d’invitation n’existe pas.')

  if (invitation.expiresAt < new Date()) {
    throw apiError('NOT_FOUND', 'Ce lien d’invitation a expiré. Demande-en un nouveau.')
  }

  if (invitation.usedCount >= invitation.maxUses) {
    throw apiError('NOT_FOUND', 'Ce lien d’invitation a déjà servi au maximum de fois prévu.')
  }

  const [tontine] = db
    .select()
    .from(tontines)
    .where(eq(tontines.id, invitation.tontineId))
    .limit(1)
    .all()

  if (!tontine) throw apiError('NOT_FOUND', 'Tontine introuvable.')

  const [president] = db
    .select({ firstName: users.firstName, lastName: users.lastName })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.tontineId, tontine.id), eq(memberships.role, 'president')))
    .limit(1)
    .all()

  const membres = db
    .select()
    .from(memberships)
    .where(and(eq(memberships.tontineId, tontine.id), eq(memberships.status, 'active')))
    .all()

  const parts = db.select().from(shares).where(eq(shares.tontineId, tontine.id)).all()

  return {
    tontineId: tontine.id,
    name: tontine.name,
    description: tontine.description,
    locality: tontine.locality,
    presidentName: [president?.firstName, president?.lastName].filter(Boolean).join(' ') || 'Le président',
    shareAmount: tontine.shareAmount,
    frequency: tontine.frequency,
    memberCount: membres.length,
    totalShares: parts.length,
    status: tontine.status,
  }
}

export interface ResultatAdhesion {
  membershipId: string
  /** Vrai si l'on a rattaché une adhésion existante au lieu d'en créer une. */
  rattache: boolean
  status: 'pending_approval' | 'active'
}

/**
 * Accepte une invitation.
 *
 * **Le cas qui compte : le membre géré qui confirme son lien.** Le bureau l'a
 * saisi à la main avec son nom et son numéro ; il a peut-être déjà des
 * cotisations à son compte. Quand il arrive enfin avec l'application, on
 * rattache son compte à l'adhésion existante — on n'en crée **pas** une
 * seconde. Créer un doublon dédoublerait son historique, ses parts, ses dus,
 * et fausserait le pot de toute la tontine.
 *
 * Le rapprochement se fait sur le numéro en E.164, seule clé fiable : deux
 * membres peuvent porter le même nom, jamais le même numéro.
 */
export function accepterInvitation(db: Db, token: string, userId: string): ResultatAdhesion {
  const apercu = apercuInvitation(db, token)

  const [utilisateur] = db.select().from(users).where(eq(users.id, userId)).limit(1).all()
  if (!utilisateur) throw apiError('UNAUTHENTICATED', 'Connecte-toi pour rejoindre.')

  const [invitation] = db.select().from(invites).where(eq(invites.token, token)).limit(1).all()

  // Déjà membre avec un compte : rien à faire, on renvoie l'adhésion existante.
  const [dejaMembre] = db
    .select()
    .from(memberships)
    .where(and(
      eq(memberships.tontineId, apercu.tontineId),
      eq(memberships.userId, userId),
    ))
    .limit(1)
    .all()

  if (dejaMembre) {
    return {
      membershipId: dejaMembre.id,
      rattache: false,
      status: dejaMembre.status === 'active' ? 'active' : 'pending_approval',
    }
  }

  // Membre géré en attente de son compte : on rattache, sans rien dupliquer.
  const [gere] = db
    .select()
    .from(memberships)
    .where(and(
      eq(memberships.tontineId, apercu.tontineId),
      isNull(memberships.userId),
      eq(memberships.managedPhone, utilisateur.phone),
    ))
    .limit(1)
    .all()

  if (gere) {
    db.update(memberships)
      .set({ userId, joinedAt: gere.joinedAt ?? new Date() })
      .where(eq(memberships.id, gere.id))
      .run()

    db.update(invites)
      .set({ usedCount: invitation!.usedCount + 1 })
      .where(eq(invites.id, invitation!.id))
      .run()

    appendLedger(db, {
      tontineId: apercu.tontineId,
      type: 'member_joined',
      actorId: userId,
      payload: {
        membershipId: gere.id,
        rattachement: true,
        name: gere.managedName,
      },
    })

    return { membershipId: gere.id, rattache: true, status: gere.status === 'active' ? 'active' : 'pending_approval' }
  }

  // Nouvel arrivant : en attente de l'accord du président.
  const membershipId = randomUUID()
  db.insert(memberships).values({
    id: membershipId,
    tontineId: apercu.tontineId,
    userId,
    role: 'member',
    status: 'pending_approval',
  }).run()

  db.update(invites)
    .set({ usedCount: invitation!.usedCount + 1 })
    .where(eq(invites.id, invitation!.id))
    .run()

  return { membershipId, rattache: false, status: 'pending_approval' }
}

/** Approuve une adhésion en attente. Réservé au président. */
export function approuverAdhesion(db: Db, membershipId: string, acteurId: string) {
  const [m] = db.select().from(memberships).where(eq(memberships.id, membershipId)).limit(1).all()
  if (!m) throw apiError('NOT_FOUND', 'Adhésion introuvable.')

  db.update(memberships)
    .set({ status: 'active', joinedAt: new Date() })
    .where(eq(memberships.id, membershipId))
    .run()

  appendLedger(db, {
    tontineId: m.tontineId,
    type: 'member_joined',
    actorId: acteurId,
    payload: { membershipId, approuve: true },
  })
}
