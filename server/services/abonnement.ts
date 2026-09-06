import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm'
import type { useDb } from '../db/index.ts'
import { memberships, subscriptionRequests, tontines, users } from '../db/schema.ts'
import type { SubscriptionRequest, User } from '../db/schema.ts'
import {
  PALIER_PAR_ID,
  depasse,
} from '../../shared/constants/abonnement.ts'
import type {
  Limite,
  Palier,
  PaidTier,
  PlanPeriodicity,
} from '../../shared/constants/abonnement.ts'
import { apiError } from '../utils/errors.ts'
import { assertTransition } from '../utils/transitions.ts'
import { journaliser } from './journal-admin.ts'
import type { Administrateur } from './journal-admin.ts'
import { notifier } from './notifications.ts'

type Db = ReturnType<typeof useDb>

export type { Administrateur }

/**
 * L'abonnement — palier du président, quotas, demandes de passage.
 *
 * **Le contrôle n'est pas rétroactif.** Un quota se vérifie au franchissement,
 * jamais en permanence sur l'existant : on demande « après cette action,
 * dépasse-t-on ? », et on ne demande jamais « dépasse-t-on en ce moment ? ».
 *
 * La raison n'est pas commerciale. Une tontine rotative est un cycle fermé :
 * au tour 6 sur 12, la moitié du groupe a cotisé six fois sans avoir encore
 * pris la main. Couper l'écran à ce moment-là ne suspend rien dans la réalité —
 * l'application ne détient pas les fonds (règle 5), le groupe continue de
 * cotiser sur le numéro du président. Ce qu'on casserait, c'est le **registre**,
 * qui deviendrait faux au moment précis où quelqu'un attend son tour. Or le
 * registre reste gratuit à tous les paliers, sans exception.
 *
 * Conséquence pratique : un président au-dessus de sa limite garde tout ce qui
 * tourne, et repasse sous la limite de lui-même à mesure que ses tontines se
 * closent. Il ne peut simplement rien ouvrir de nouveau.
 */

/** Une tontine « active » occupe une place : publiée et pas encore close. */
const STATUTS_ACTIFS = ['open', 'running'] as const

/**
 * L'effectif compte **toutes les adhésions sauf celles qui sont parties**.
 *
 * Compter les seules adhésions `active` ouvrirait un contournement : vingt
 * invitations en attente d'approbation ne coûteraient rien jusqu'à ce que le
 * président les accepte toutes d'un coup, et le refus tomberait alors sur des
 * gens déjà entrés dans le groupe.
 */
const STATUT_HORS_EFFECTIF = 'left' as const

/* ------------------------------------------------------------------ *
 * Palier courant
 * ------------------------------------------------------------------ */

/**
 * Le palier réellement en vigueur.
 *
 * `planUntil` périmé fait retomber au gratuit **au calcul**, sans écriture ni
 * tâche planifiée : un champ qui se périme tout seul ne peut pas se
 * désynchroniser d'un `cron` qui n'a pas tourné.
 */
export function palierDe(user: Pick<User, 'planTier' | 'planUntil'>, maintenant = new Date()): Palier {
  if (user.planTier === 'free') return PALIER_PAR_ID.free
  if (user.planUntil && user.planUntil.getTime() <= maintenant.getTime()) return PALIER_PAR_ID.free
  return PALIER_PAR_ID[user.planTier]
}

/** Le président d'une tontine, seul redevable du forfait. */
export function presidentDe(db: Db, tontineId: string): User {
  const [ligne] = db
    .select({ utilisateur: users })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(
      eq(memberships.tontineId, tontineId),
      eq(memberships.role, 'president'),
    ))
    .limit(1)
    .all()

  if (ligne) return ligne.utilisateur

  // Repli sur le créateur : une tontine au brouillon n'a pas encore d'adhésion
  // de président, mais elle a déjà quelqu'un qui en répond.
  const [tontine] = db.select().from(tontines).where(eq(tontines.id, tontineId)).limit(1).all()
  if (!tontine) throw apiError('NOT_FOUND', 'Tontine introuvable.')

  const [createur] = db.select().from(users).where(eq(users.id, tontine.createdBy)).limit(1).all()
  if (!createur) throw apiError('NOT_FOUND', 'Président introuvable.')

  return createur
}

/* ------------------------------------------------------------------ *
 * Consommation
 * ------------------------------------------------------------------ */

/** Le nombre de tontines en cours dont l'utilisateur est président. */
export function tontinesActivesDe(db: Db, userId: string): number {
  return db
    .select({ id: tontines.id })
    .from(tontines)
    .innerJoin(memberships, eq(memberships.tontineId, tontines.id))
    .where(and(
      eq(memberships.userId, userId),
      eq(memberships.role, 'president'),
      eq(memberships.status, 'active'),
      inArray(tontines.status, [...STATUTS_ACTIFS]),
    ))
    .all()
    .length
}

/** L'effectif d'une tontine, au sens du quota. */
export function effectifDe(db: Db, tontineId: string): number {
  return db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(
      eq(memberships.tontineId, tontineId),
      ne(memberships.status, STATUT_HORS_EFFECTIF),
    ))
    .all()
    .length
}

/* ------------------------------------------------------------------ *
 * Contrôles de quota
 * ------------------------------------------------------------------ */

/**
 * Une tontine de plus est-elle permise ? Appelé à la **publication**, pas à la
 * création : un brouillon n'engage personne et ne se compte pas.
 */
export function verifierQuotaTontines(db: Db, user: User, maintenant = new Date()): void {
  const palier = palierDe(user, maintenant)
  const effectif = tontinesActivesDe(db, user.id)

  if (depasse(palier.tontinesActives, effectif)) {
    throw apiError(
      'PLAN_LIMIT',
      `Le palier ${palier.nom} permet ${palier.tontinesActives} tontine`
      + `${(palier.tontinesActives ?? 0) > 1 ? 's' : ''} en cours à la fois. `
      + 'Tes tontines en cours continuent normalement : pour en ouvrir une '
      + 'nouvelle, close l’une d’elles ou passe à un palier supérieur.',
      { field: 'planTier' },
    )
  }
}

/**
 * Un membre de plus est-il permis dans cette tontine ?
 *
 * Le quota est celui du **président**, pas de l'appelant : quelqu'un qui
 * accepte une invitation ne paie pas le forfait de la tontine qu'il rejoint.
 */
export function verifierQuotaMembres(
  db: Db,
  tontineId: string,
  ajout = 1,
  maintenant = new Date(),
): void {
  const palier = palierDe(presidentDe(db, tontineId), maintenant)
  const effectif = effectifDe(db, tontineId)

  if (depasse(palier.membresParTontine, effectif, ajout)) {
    throw apiError(
      'PLAN_LIMIT',
      `Cette tontine a atteint son nombre de membres (${palier.membresParTontine}). `
      + 'Le président peut l’augmenter depuis son abonnement.',
      { field: 'members' },
    )
  }
}

/** `true` si un membre de plus tient encore. Sert à l'affichage, jamais à l'autorisation. */
export function placeDisponible(db: Db, tontineId: string, maintenant = new Date()): boolean {
  const palier = palierDe(presidentDe(db, tontineId), maintenant)
  return !depasse(palier.membresParTontine, effectifDe(db, tontineId))
}

/* ------------------------------------------------------------------ *
 * État affiché à l'écran
 * ------------------------------------------------------------------ */

export interface ConsommationTontine {
  id: string
  name: string
  emoji: string | null
  effectif: number
  limite: Limite
}

export interface EtatAbonnement {
  tier: Palier['id']
  nom: string
  /** Fin des droits. `null` au palier gratuit, qui n'expire pas. */
  jusquAu: string | null
  quotas: { tontinesActives: Limite, membresParTontine: Limite }
  consommation: { tontinesActives: number, tontines: ConsommationTontine[] }
  /** `true` si l'existant dépasse déjà le palier — affiché, jamais bloquant. */
  auDessus: boolean
  demandeEnCours: {
    id: string
    tier: string
    periodicity: PlanPeriodicity
    priceFcfa: number
    createdAt: string
  } | null
}

/** Tout ce que `/app/abonnement` affiche, calculé côté serveur (règle 2). */
export function etatAbonnement(db: Db, user: User, maintenant = new Date()): EtatAbonnement {
  const palier = palierDe(user, maintenant)

  const mesTontines = db
    .select({ id: tontines.id, name: tontines.name, emoji: tontines.emoji })
    .from(tontines)
    .innerJoin(memberships, eq(memberships.tontineId, tontines.id))
    .where(and(
      eq(memberships.userId, user.id),
      eq(memberships.role, 'president'),
      eq(memberships.status, 'active'),
      inArray(tontines.status, [...STATUTS_ACTIFS]),
    ))
    .orderBy(asc(tontines.name))
    .all()

  const consommees = mesTontines.map(t => ({
    ...t,
    effectif: effectifDe(db, t.id),
    limite: palier.membresParTontine,
  }))

  const [demande] = db
    .select()
    .from(subscriptionRequests)
    .where(and(
      eq(subscriptionRequests.userId, user.id),
      eq(subscriptionRequests.status, 'pending'),
    ))
    .orderBy(desc(subscriptionRequests.createdAt))
    .limit(1)
    .all()

  return {
    tier: palier.id,
    nom: palier.nom,
    jusquAu: palier.id === 'free' ? null : (user.planUntil?.toISOString() ?? null),
    quotas: {
      tontinesActives: palier.tontinesActives,
      membresParTontine: palier.membresParTontine,
    },
    consommation: {
      tontinesActives: mesTontines.length,
      tontines: consommees,
    },
    auDessus: depasse(palier.tontinesActives, mesTontines.length, 0)
      || consommees.some(t => depasse(t.limite, t.effectif, 0)),
    demandeEnCours: demande
      ? {
          id: demande.id,
          tier: demande.tier,
          periodicity: demande.periodicity,
          priceFcfa: demande.priceFcfa,
          createdAt: demande.createdAt.toISOString(),
        }
      : null,
  }
}

/* ------------------------------------------------------------------ *
 * Demandes de passage
 * ------------------------------------------------------------------ */

/**
 * Enregistre une demande de passage.
 *
 * L'application **n'encaisse rien** : elle ne sait pas prélever, et le
 * prélèvement récurrent n'est pas garanti sur les rails ivoiriens. La demande
 * est une intention ; le règlement se fait hors application, et un
 * administrateur pose le palier à la main une fois qu'il l'a constaté.
 *
 * Le prix est lu **dans la grille**, jamais dans le corps de la requête
 * (règle 2), puis figé sur la demande : la grille peut bouger entre la demande
 * et la décision, le président doit être facturé ce qu'on lui a montré.
 */
export function creerDemande(
  db: Db,
  userId: string,
  input: { tier: PaidTier, periodicity: PlanPeriodicity },
): { id: string, tier: PaidTier, periodicity: PlanPeriodicity, priceFcfa: number } {
  const [enCours] = db
    .select()
    .from(subscriptionRequests)
    .where(and(
      eq(subscriptionRequests.userId, userId),
      eq(subscriptionRequests.status, 'pending'),
    ))
    .limit(1)
    .all()

  if (enCours) {
    throw apiError(
      'INVALID_TRANSITION',
      'Une demande est déjà en cours. Elle sera traitée sous peu.',
      { field: 'tier' },
    )
  }

  const palier = PALIER_PAR_ID[input.tier]
  const priceFcfa = input.periodicity === 'yearly' ? palier.prixAnnuel : palier.prixMensuel

  const id = randomUUID()
  db.insert(subscriptionRequests).values({
    id,
    userId,
    tier: input.tier,
    periodicity: input.periodicity,
    priceFcfa,
    status: 'pending',
  }).run()

  return { id, tier: input.tier, periodicity: input.periodicity, priceFcfa }
}

export interface DemandeAdmin {
  id: string
  userId: string
  phone: string
  firstName: string | null
  lastName: string | null
  tierActuel: string
  tier: string
  periodicity: PlanPeriodicity
  priceFcfa: number
  status: SubscriptionRequest['status']
  createdAt: Date
  reviewedAt: Date | null
  reviewNote: string | null
}

function versDemandeAdmin(ligne: { demande: SubscriptionRequest, utilisateur: User }): DemandeAdmin {
  return {
    id: ligne.demande.id,
    userId: ligne.utilisateur.id,
    phone: ligne.utilisateur.phone,
    firstName: ligne.utilisateur.firstName,
    lastName: ligne.utilisateur.lastName,
    tierActuel: palierDe(ligne.utilisateur).id,
    tier: ligne.demande.tier,
    periodicity: ligne.demande.periodicity,
    priceFcfa: ligne.demande.priceFcfa,
    status: ligne.demande.status,
    createdAt: ligne.demande.createdAt,
    reviewedAt: ligne.demande.reviewedAt,
    reviewNote: ligne.demande.reviewNote,
  }
}

/** La file, du plus ancien au plus récent : personne ne s'enfonce dans la pile. */
export function demandesEnAttente(db: Db): DemandeAdmin[] {
  return db
    .select({ demande: subscriptionRequests, utilisateur: users })
    .from(subscriptionRequests)
    .innerJoin(users, eq(users.id, subscriptionRequests.userId))
    .where(eq(subscriptionRequests.status, 'pending'))
    .orderBy(asc(subscriptionRequests.createdAt))
    .all()
    .map(versDemandeAdmin)
}

export function demandesTraitees(db: Db): DemandeAdmin[] {
  return db
    .select({ demande: subscriptionRequests, utilisateur: users })
    .from(subscriptionRequests)
    .innerJoin(users, eq(users.id, subscriptionRequests.userId))
    .where(inArray(subscriptionRequests.status, ['approved', 'rejected']))
    .orderBy(desc(subscriptionRequests.reviewedAt))
    .all()
    .map(versDemandeAdmin)
}

/**
 * Ajoute des mois en gardant le quantième quand il existe.
 *
 * `setMonth` seul ferait glisser le 31 janvier au 3 mars : l'échéance d'un
 * abonnement ne doit pas dériver d'un mois sur l'autre.
 */
function ajouterMois(depuis: Date, mois: number): Date {
  const quantieme = depuis.getDate()
  const fin = new Date(depuis)
  fin.setDate(1)
  fin.setMonth(fin.getMonth() + mois)
  const dernierJour = new Date(fin.getFullYear(), fin.getMonth() + 1, 0).getDate()
  fin.setDate(Math.min(quantieme, dernierJour))
  return fin
}

function chargerDemande(db: Db, id: string): SubscriptionRequest {
  const [demande] = db
    .select()
    .from(subscriptionRequests)
    .where(eq(subscriptionRequests.id, id))
    .limit(1)
    .all()

  if (!demande) throw apiError('NOT_FOUND', 'Demande introuvable.')
  return demande
}

/**
 * Approuve une demande : pose le palier et l'échéance sur le président.
 *
 * Renouveler le **même** palier prolonge les droits en cours ; changer de
 * palier repart de maintenant. Sans cela, un président qui monte de Standard à
 * Plus en cours de mois perdrait ses jours restants, ou en gagnerait
 * indûment — deux façons de se tromper sur ce qu'il a payé.
 */
export function approuverDemande(
  db: Db,
  id: string,
  admin: Administrateur,
  maintenant = new Date(),
) {
  const demande = chargerDemande(db, id)
  assertTransition('subscriptionRequest', demande.status, 'approved')

  const [utilisateur] = db.select().from(users).where(eq(users.id, demande.userId)).limit(1).all()
  if (!utilisateur) throw apiError('NOT_FOUND', 'Compte introuvable.')

  const memePalier = utilisateur.planTier === demande.tier
  const droitsEnCours = utilisateur.planUntil && utilisateur.planUntil.getTime() > maintenant.getTime()
  const depart = memePalier && droitsEnCours ? utilisateur.planUntil! : maintenant
  const planUntil = ajouterMois(depart, demande.periodicity === 'yearly' ? 12 : 1)

  db.update(users)
    .set({ planTier: demande.tier, planUntil })
    .where(eq(users.id, demande.userId))
    .run()

  db.update(subscriptionRequests)
    .set({ status: 'approved', reviewedBy: admin.id, reviewedAt: maintenant, reviewNote: null })
    .where(eq(subscriptionRequests.id, id))
    .run()

  journaliser(db, admin, 'abonnement_approuve', demande.userId, {
    demandeId: id,
    ancienPalier: utilisateur.planTier,
    nouveauPalier: demande.tier,
    periodicite: demande.periodicity,
  })

  // Règle 21 : ni montant ni date chiffrée dans une notification — elle
  // s'affiche sur un écran verrouillé, et le détail est à un clic.
  notifier(db, demande.userId, {
    type: 'abonnement_approuve',
    title: 'Ton abonnement est actif',
    body: `Le palier ${PALIER_PAR_ID[demande.tier].nom} est en place. Ouvre ton abonnement pour voir jusqu’à quand.`,
    url: '/app/abonnement',
  })

  return { id, status: 'approved' as const, tier: demande.tier, planUntil }
}

/** Refuse une demande. Le motif est obligatoire : un refus sans raison est une impasse. */
export function rejeterDemande(
  db: Db,
  id: string,
  admin: Administrateur,
  motif: string,
  maintenant = new Date(),
) {
  const demande = chargerDemande(db, id)
  assertTransition('subscriptionRequest', demande.status, 'rejected')

  const raison = motif.trim()
  if (raison.length < 5) {
    throw apiError('VALIDATION_ERROR', 'Explique le refus en une phrase.', { field: 'motif' })
  }

  db.update(subscriptionRequests)
    .set({ status: 'rejected', reviewedBy: admin.id, reviewedAt: maintenant, reviewNote: raison })
    .where(eq(subscriptionRequests.id, id))
    .run()

  journaliser(db, admin, 'abonnement_rejete', demande.userId, { demandeId: id, motif: raison })

  notifier(db, demande.userId, {
    type: 'abonnement_rejete',
    title: 'Ta demande d’abonnement n’a pas abouti',
    body: 'Ouvre ton abonnement pour lire la raison et refaire une demande.',
    url: '/app/abonnement',
  })

  return { id, status: 'rejected' as const }
}

/** La dernière décision rendue sur les demandes d'un président, pour l'afficher. */
export function derniereDecision(db: Db, userId: string): SubscriptionRequest | null {
  const [demande] = db
    .select()
    .from(subscriptionRequests)
    .where(and(
      eq(subscriptionRequests.userId, userId),
      inArray(subscriptionRequests.status, ['approved', 'rejected']),
    ))
    .orderBy(desc(subscriptionRequests.reviewedAt))
    .limit(1)
    .all()

  return demande ?? null
}
