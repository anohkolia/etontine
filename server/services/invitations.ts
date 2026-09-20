import { randomBytes, randomUUID } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import type { useDb } from '../db/index.ts'
import { invites, memberships, shares, tontines, users } from '../db/schema.ts'
import { apiError } from '../utils/errors.ts'
import { assertTransition } from '../utils/transitions.ts'
import { placeDisponible, verifierQuotaMembres } from './abonnement.ts'
import { appendLedger } from './ledger.ts'
import { attribuerParts } from './membres.ts'
import { notifier } from './notifications.ts'

type Db = ReturnType<typeof useDb>

/** Durée de vie d'un lien d'invitation. */
const VALIDITE_JOURS = 30

/** Crée un lien d'invitation. Le jeton est imprévisible, jamais dérivé de l'id. */
export async function creerInvitation(db: Db, tontineId: string, createdBy: string, maxUses = 20) {
  const token = randomBytes(16).toString('base64url')
  const expiresAt = new Date(Date.now() + VALIDITE_JOURS * 86_400_000)

  await db.insert(invites).values({
    id: randomUUID(),
    token,
    tontineId,
    createdBy,
    expiresAt,
    maxUses,
    usedCount: 0,
  })

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
  /**
   * `true` quand la tontine a atteint le nombre de membres du palier de son
   * président. L'écran de jonction dit alors que **le groupe est complet** — il
   * ne dit jamais que le président n'a pas payé : l'arrivant n'a pas à
   * connaître l'abonnement de quelqu'un d'autre, et ce n'est pas son affaire.
   */
  complet: boolean
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
export async function apercuInvitation(db: Db, token: string): Promise<ApercuInvitation> {
  const [invitation] = await db.select().from(invites).where(eq(invites.token, token)).limit(1)

  if (!invitation) throw apiError('NOT_FOUND', 'Ce lien d’invitation n’existe pas.')

  if (invitation.expiresAt < new Date()) {
    throw apiError('NOT_FOUND', 'Ce lien d’invitation a expiré. Demande-en un nouveau.')
  }

  if (invitation.usedCount >= invitation.maxUses) {
    throw apiError('NOT_FOUND', 'Ce lien d’invitation a déjà servi au maximum de fois prévu.')
  }

  const [tontine] = await db
    .select()
    .from(tontines)
    .where(eq(tontines.id, invitation.tontineId))
    .limit(1)

  if (!tontine) throw apiError('NOT_FOUND', 'Tontine introuvable.')

  const [president] = await db
    .select({ firstName: users.firstName, lastName: users.lastName })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.tontineId, tontine.id), eq(memberships.role, 'president')))
    .limit(1)

  const membres = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.tontineId, tontine.id), eq(memberships.status, 'active')))

  const parts = await db.select().from(shares).where(eq(shares.tontineId, tontine.id))

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
    complet: !(await placeDisponible(db, tontine.id)),
  }
}

export interface ResultatAdhesion {
  membershipId: string
  /**
   * Vrai si l'on a demandé à reprendre une adhésion existante — un siège de
   * membre géré — au lieu d'en créer une. Le statut est alors
   * `pending_approval` : le président doit confirmer.
   */
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
 * Le rapprochement se fait sur le numéro en E.164 — mais **le numéro n'est
 * plus prouvé** : depuis que la connexion se fait par e-mail et code,
 * n'importe qui peut s'inscrire avec le numéro d'un autre. Le rattachement
 * est donc une *demande* : `userId` reste nul, le président est prévenu, et
 * c'est lui qui confirme (`confirmerRattachement`). Jusque-là, le demandeur
 * ne voit rien de la tontine.
 */
export async function accepterInvitation(db: Db, token: string, userId: string): Promise<ResultatAdhesion> {
  const apercu = await apercuInvitation(db, token)

  const [utilisateur] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  if (!utilisateur) throw apiError('UNAUTHENTICATED', 'Connecte-toi pour rejoindre.')

  const [invitation] = await db.select().from(invites).where(eq(invites.token, token)).limit(1)

  // Déjà membre avec un compte : rien à faire, on renvoie l'adhésion existante.
  const [dejaMembre] = await db
    .select()
    .from(memberships)
    .where(and(
      eq(memberships.tontineId, apercu.tontineId),
      eq(memberships.userId, userId),
    ))
    .limit(1)

  if (dejaMembre) {
    return {
      membershipId: dejaMembre.id,
      rattache: false,
      status: dejaMembre.status === 'active' ? 'active' : 'pending_approval',
    }
  }

  // Membre géré en attente de son compte : on rattache, sans rien dupliquer.
  const [gere] = await db
    .select()
    .from(memberships)
    .where(and(
      eq(memberships.tontineId, apercu.tontineId),
      isNull(memberships.userId),
      eq(memberships.managedPhone, utilisateur.phone),
    ))
    .limit(1)

  if (gere) {
    // Une demande déjà posée par ce même compte : on la renvoie telle quelle,
    // sans prévenir le président une seconde fois.
    if (gere.claimedByUserId === userId) {
      return { membershipId: gere.id, rattache: true, status: 'pending_approval' }
    }

    await db.update(memberships)
      .set({ claimedByUserId: userId, claimedAt: new Date() })
      .where(eq(memberships.id, gere.id))

    await db.update(invites)
      .set({ usedCount: invitation!.usedCount + 1 })
      .where(eq(invites.id, invitation!.id))

    const [president] = await db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.tontineId, apercu.tontineId), eq(memberships.role, 'president')))
      .limit(1)

    if (president?.userId) {
      await notifier(db, president.userId, {
        type: 'rattachement_demande',
        tontineId: apercu.tontineId,
        title: 'Un membre demande à reprendre son siège',
        body: `${gere.managedName ?? 'Un membre'} s’est inscrit et demande à être rattaché. Confirme que c’est bien lui.`,
        url: `/app/tontine/${apercu.tontineId}/membres`,
      })
    }

    return { membershipId: gere.id, rattache: true, status: 'pending_approval' }
  }

  // Une tontine démarrée n'accueille plus personne : les tours et les
  // cotisations sont générés sur des parts figées, et un arrivant n'y aurait ni
  // tour ni dû. On le dit **ici**, au moment où il clique, plutôt que de le
  // laisser en attente d'un accord que le président ne pourrait pas donner.
  // Le rattachement d'un membre géré, lui, passe plus haut : son siège existe
  // déjà, il ne fait que reprendre le sien.
  const [tontineCourante] = await db
    .select({ status: tontines.status, rotationFrozenAt: tontines.rotationFrozenAt })
    .from(tontines)
    .where(eq(tontines.id, apercu.tontineId))
    .limit(1)

  if (tontineCourante?.status !== 'draft' && tontineCourante?.status !== 'open') {
    throw apiError(
      'FORBIDDEN',
      'Cette tontine a déjà démarré : elle n’accueille plus de nouveaux membres.',
      { field: 'status' },
    )
  }

  // Nouvel arrivant : il occupe une place de plus, donc le quota du président
  // s'applique. Le contrôle est **ici** et pas seulement à la création du lien :
  // un lien créé quand il restait deux places peut être ouvert par cinq
  // personnes à la fois, et c'est ce dernier filet qui départage.
  await verifierQuotaMembres(db, apercu.tontineId)

  // Nouvel arrivant : en attente de l'accord du président.
  const membershipId = randomUUID()
  await db.insert(memberships).values({
    id: membershipId,
    tontineId: apercu.tontineId,
    userId,
    role: 'member',
    status: 'pending_approval',
  })

  await db.update(invites)
    .set({ usedCount: invitation!.usedCount + 1 })
    .where(eq(invites.id, invitation!.id))

  return { membershipId, rattache: false, status: 'pending_approval' }
}

/**
 * Approuve une adhésion en attente. Réservé au président.
 *
 * **Et lui attribue ses parts.** L'oubli était fatal : un arrivant par lien
 * n'en recevait aucune, donc n'entrait dans aucune rotation, ne cotisait
 * jamais et ne prenait jamais la main. Il était membre au sens de la table et
 * absent au sens de la tontine.
 *
 * L'approbation s'arrête au démarrage. Les tours et les cotisations sont tous
 * générés d'un coup à ce moment-là, sur les parts figées : en ajouter une
 * ensuite ne créerait ni le tour du nouveau venu ni ses cotisations, et
 * fausserait le pot attendu de tous les tours déjà en cours. Mieux vaut un
 * refus clair qu'une adhésion qui n'existe qu'à moitié.
 */
export async function approuverAdhesion(db: Db, membershipId: string, acteurId: string, parts = 1) {
  const [m] = await db.select().from(memberships).where(eq(memberships.id, membershipId)).limit(1)
  if (!m) throw apiError('NOT_FOUND', 'Adhésion introuvable.')

  assertTransition('membership', m.status, 'active')

  const [tontine] = await db.select().from(tontines).where(eq(tontines.id, m.tontineId)).limit(1)
  if (tontine?.status === 'running' || tontine?.rotationFrozenAt) {
    throw apiError(
      'FORBIDDEN',
      'La tontine a démarré : l’ordre de passage est figé, on ne peut plus y ajouter de membre.',
      { field: 'status' },
    )
  }

  await verifierQuotaMembres(db, m.tontineId)

  await db.update(memberships)
    .set({ status: 'active', joinedAt: new Date() })
    .where(eq(memberships.id, membershipId))

  await attribuerParts(db, m.tontineId, membershipId, parts)

  await appendLedger(db, {
    tontineId: m.tontineId,
    type: 'member_joined',
    actorId: acteurId,
    payload: { membershipId, approuve: true, shares: parts },
  })
}

/** Refuse une adhésion en attente. La transition passe par la table d'états. */
export async function refuserAdhesion(db: Db, membershipId: string, acteurId: string) {
  const [m] = await db.select().from(memberships).where(eq(memberships.id, membershipId)).limit(1)
  if (!m) throw apiError('NOT_FOUND', 'Adhésion introuvable.')

  assertTransition('membership', m.status, 'left')

  await db.update(memberships).set({ status: 'left' }).where(eq(memberships.id, membershipId))

  await appendLedger(db, {
    tontineId: m.tontineId,
    type: 'member_left',
    actorId: acteurId,
    payload: { membershipId, refuse: true },
  })
}

/**
 * Le président confirme qu'un compte est bien le membre géré qu'il avait
 * saisi : le compte prend le siège, avec son historique.
 *
 * C'est le remplacement de la preuve par SMS : plus personne ne prouve son
 * numéro, mais le président connaît ses membres, et c'est lui qui a saisi le
 * numéro au départ.
 */
export async function confirmerRattachement(db: Db, membershipId: string, acteurId: string): Promise<void> {
  const [m] = await db.select().from(memberships).where(eq(memberships.id, membershipId)).limit(1)
  if (!m) throw apiError('NOT_FOUND', 'Adhésion introuvable.')
  if (!m.claimedByUserId) {
    throw apiError('INVALID_TRANSITION', 'Aucune demande de rattachement sur ce membre.', { field: 'claim' })
  }
  if (m.userId) {
    throw apiError('INVALID_TRANSITION', 'Ce siège est déjà rattaché à un compte.', { field: 'claim' })
  }

  // Le même compte ne peut pas siéger deux fois dans une tontine : l'unicité
  // est tenue par la base, on le dit avant qu'elle ne le refuse.
  const [deja] = await db.select({ id: memberships.id }).from(memberships)
    .where(and(eq(memberships.tontineId, m.tontineId), eq(memberships.userId, m.claimedByUserId)))
    .limit(1)
  if (deja) {
    throw apiError('INVALID_TRANSITION', 'Ce compte est déjà membre de la tontine.', { field: 'claim' })
  }

  const demandeur = m.claimedByUserId

  await db.update(memberships)
    .set({ userId: demandeur, claimedByUserId: null, claimedAt: null, joinedAt: m.joinedAt ?? new Date() })
    .where(eq(memberships.id, membershipId))

  await appendLedger(db, {
    tontineId: m.tontineId,
    type: 'member_joined',
    actorId: acteurId,
    payload: { membershipId, rattachement: true, name: m.managedName, userId: demandeur },
  })

  await notifier(db, demandeur, {
    type: 'rattachement_confirme',
    tontineId: m.tontineId,
    title: 'Ton siège est confirmé',
    body: 'Le président a confirmé ton rattachement. Tu retrouves ton historique dans la tontine.',
    url: `/app/tontine/${m.tontineId}`,
  })
}

/** Le président refuse : la demande s'efface, le siège reste géré, le demandeur l'apprend. */
export async function refuserRattachement(db: Db, membershipId: string, acteurId: string): Promise<void> {
  const [m] = await db.select().from(memberships).where(eq(memberships.id, membershipId)).limit(1)
  if (!m) throw apiError('NOT_FOUND', 'Adhésion introuvable.')
  if (!m.claimedByUserId) {
    throw apiError('INVALID_TRANSITION', 'Aucune demande de rattachement sur ce membre.', { field: 'claim' })
  }

  const demandeur = m.claimedByUserId

  await db.update(memberships)
    .set({ claimedByUserId: null, claimedAt: null })
    .where(eq(memberships.id, membershipId))

  await appendLedger(db, {
    tontineId: m.tontineId,
    type: 'settings_changed',
    actorId: acteurId,
    payload: { changement: 'rattachement_refuse', membershipId, name: m.managedName },
  })

  await notifier(db, demandeur, {
    type: 'rattachement_refuse',
    tontineId: m.tontineId,
    title: 'Rattachement refusé',
    body: 'Le président n’a pas reconnu ta demande. Si c’est une erreur, contacte-le directement.',
  })
}
