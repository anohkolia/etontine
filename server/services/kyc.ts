import { and, asc, desc, eq, isNotNull } from 'drizzle-orm'
import type { useDb } from '../db/index.ts'
import { adminAudit, users } from '../db/schema.ts'
import { apiError } from '../utils/errors.ts'
import { natureDePiece } from '../utils/fichiers.ts'
import { journaliser } from './journal-admin.ts'
import type { Administrateur } from './journal-admin.ts'
import { notifier } from './notifications.ts'

type Db = ReturnType<typeof useDb>

export type { Administrateur }

/** Palier accordé par une vérification d'identité réussie. */
const PALIER_ACCORDE = 2

export interface Dossier {
  userId: string
  phone: string
  firstName: string | null
  lastName: string | null
  kycStatus: 'none' | 'pending_review' | 'approved' | 'rejected'
  kycLevel: number
  submittedAt: Date | null
  reviewedAt: Date | null
  rejectionReason: string | null
  hasDocument: boolean
  hasSelfie: boolean
  /** Ce qu'il faut pour l'afficher : une image, ou un PDF. */
  documentNature: 'image' | 'pdf' | null
  selfieNature: 'image' | 'pdf' | null
}

function versDossier(u: typeof users.$inferSelect): Dossier {
  return {
    userId: u.id,
    phone: u.phone,
    firstName: u.firstName,
    lastName: u.lastName,
    kycStatus: u.kycStatus,
    kycLevel: u.kycLevel,
    submittedAt: u.kycSubmittedAt,
    reviewedAt: u.kycReviewedAt,
    rejectionReason: u.kycRejectionReason,
    // On dit qu'une pièce existe, jamais où elle est : l'adresse de stockage
    // n'a pas à circuler, elle se demande par la route dédiée.
    hasDocument: Boolean(u.kycDocumentUrl),
    hasSelfie: Boolean(u.kycSelfieUrl),
    // La nature, en revanche, doit circuler : un PDF rendu dans une balise
    // `img` ne signale rien, il donne une image cassée, et l'administrateur en
    // conclut que la personne n'a rien déposé.
    documentNature: u.kycDocumentUrl ? natureDePiece(u.kycDocumentUrl) : null,
    selfieNature: u.kycSelfieUrl ? natureDePiece(u.kycSelfieUrl) : null,
  }
}

/**
 * La file des dossiers en attente.
 *
 * Du plus ancien au plus récent : quelqu'un qui attend depuis trois jours passe
 * avant celui qui a déposé ce matin. Une file triée à l'envers laisse les
 * dossiers difficiles s'enfoncer indéfiniment.
 */
export function dossiersEnAttente(db: Db): Dossier[] {
  return db
    .select()
    .from(users)
    .where(eq(users.kycStatus, 'pending_review'))
    .orderBy(asc(users.kycSubmittedAt))
    .all()
    .map(versDossier)
}

/** Les dossiers déjà traités, du plus récent au plus ancien. */
export function dossiersTraites(db: Db, limite = 50): Dossier[] {
  return db
    .select()
    .from(users)
    .where(and(isNotNull(users.kycReviewedAt)))
    .orderBy(desc(users.kycReviewedAt))
    .limit(limite)
    .all()
    .map(versDossier)
}

export function dossier(db: Db, userId: string): Dossier {
  const [u] = db.select().from(users).where(eq(users.id, userId)).limit(1).all()
  if (!u) throw apiError('NOT_FOUND', 'Dossier introuvable.')
  return versDossier(u)
}

/** L'adresse de stockage d'une pièce, pour la route qui la sert. */
export function urlPiece(db: Db, userId: string, type: 'document' | 'selfie'): string | null {
  const [u] = db.select().from(users).where(eq(users.id, userId)).limit(1).all()
  if (!u) return null
  return (type === 'document' ? u.kycDocumentUrl : u.kycSelfieUrl) ?? null
}

/**
 * Approuve un dossier : le palier 2 est accordé.
 *
 * C'est ce qui permet de publier une tontine, donc de devenir le numéro vers
 * lequel des dizaines de personnes enverront de l'argent. La décision est
 * volontairement manuelle : aucune règle automatique ne remplace le fait de
 * regarder une pièce et un visage.
 */
export function approuverDossier(db: Db, userId: string, admin: Administrateur) {
  const [u] = db.select().from(users).where(eq(users.id, userId)).limit(1).all()
  if (!u) throw apiError('NOT_FOUND', 'Dossier introuvable.')

  if (u.kycStatus !== 'pending_review') {
    throw apiError(
      'INVALID_TRANSITION',
      'Ce dossier n’est pas en attente d’examen.',
      { field: 'kycStatus' },
    )
  }

  if (u.id === admin.id) {
    // Un administrateur qui approuve son propre dossier se délivre un quitus :
    // c'est la même règle de séparation que pour les cotisations.
    throw apiError('FORBIDDEN', 'Tu ne peux pas approuver ton propre dossier.')
  }

  const maintenant = new Date()
  db.update(users).set({
    kycStatus: 'approved',
    kycLevel: Math.max(u.kycLevel, PALIER_ACCORDE),
    kycReviewedBy: admin.id,
    kycReviewedAt: maintenant,
    kycRejectionReason: null,
  }).where(eq(users.id, userId)).run()

  journaliser(db, admin, 'kyc_approuve', userId, {
    ancienPalier: u.kycLevel,
    nouveauPalier: Math.max(u.kycLevel, PALIER_ACCORDE),
  })

  notifier(db, userId, {
    type: 'kyc_approuve',
    title: 'Ton identité est vérifiée',
    body: 'Tu peux maintenant publier une tontine.',
    url: '/app/profil',
  })

  return { userId, kycStatus: 'approved' as const, kycLevel: PALIER_ACCORDE }
}

/**
 * Rejette un dossier. **Le motif est obligatoire.**
 *
 * Un refus sans explication est un cul-de-sac : la personne ne sait pas quoi
 * corriger, redépose la même chose, et l'on repart pour un tour. Le motif est
 * ce qui rend le second dépôt utile.
 */
export function rejeterDossier(db: Db, userId: string, admin: Administrateur, motif: string) {
  if (!motif || motif.trim().length < 10) {
    throw apiError(
      'VALIDATION_ERROR',
      'Explique ce qui ne va pas, pour que la personne sache quoi corriger.',
      { field: 'reason' },
    )
  }

  const [u] = db.select().from(users).where(eq(users.id, userId)).limit(1).all()
  if (!u) throw apiError('NOT_FOUND', 'Dossier introuvable.')

  if (u.kycStatus !== 'pending_review') {
    throw apiError('INVALID_TRANSITION', 'Ce dossier n’est pas en attente d’examen.', { field: 'kycStatus' })
  }

  db.update(users).set({
    kycStatus: 'rejected',
    kycReviewedBy: admin.id,
    kycReviewedAt: new Date(),
    kycRejectionReason: motif.trim(),
    // Le palier n'est pas retiré : quelqu'un qui l'avait déjà ne le perd pas
    // sur un dépôt raté.
  }).where(eq(users.id, userId)).run()

  journaliser(db, admin, 'kyc_rejete', userId, { motif: motif.trim() })

  notifier(db, userId, {
    type: 'kyc_rejete',
    title: 'Ta vérification d’identité n’a pas abouti',
    body: 'Ouvre l’application pour voir ce qui doit être corrigé.',
    url: '/app/profil/identite',
  })

  return { userId, kycStatus: 'rejected' as const }
}

/** Consigne une consultation de pièce : regarder est aussi une action. */
export function journaliserConsultation(
  db: Db,
  admin: Administrateur,
  userId: string,
  type: 'document' | 'selfie',
): void {
  journaliser(db, admin, 'kyc_piece_consultee', userId, { type })
}

/** Le journal d'administration, du plus récent au plus ancien. */
export function journalAdministration(db: Db, limite = 100) {
  return db
    .select()
    .from(adminAudit)
    .orderBy(desc(adminAudit.createdAt))
    .limit(limite)
    .all()
}
