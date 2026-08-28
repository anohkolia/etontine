import { and, eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { useDb } from '../db/index.ts'
import { memberships } from '../db/schema.ts'
import type { Membership, User } from '../db/schema.ts'
import type { MembershipRole } from '../../shared/schemas/index.ts'
import { apiError } from './errors.ts'

/**
 * L'utilisateur authentifié, ou `401 UNAUTHENTICATED`.
 * Le middleware de session l'a déjà posé sur le contexte.
 */
export function requireUser(event: H3Event): User {
  const user = event.context.user as User | null | undefined
  if (!user) {
    throw apiError('UNAUTHENTICATED', 'Connecte-toi pour continuer.')
  }
  return user
}

/**
 * Le rôle est **par tontine, jamais global** (docs/data-model.md §3). Un même
 * utilisateur est président ici et simple membre ailleurs.
 *
 * Le client n'envoie jamais son rôle : il est résolu ici, à partir de son
 * adhésion à la tontine concernée. C'est la seule source acceptable.
 */
export async function requireMembership(
  event: H3Event,
  tontineId: string,
  rolesAutorises?: readonly MembershipRole[],
): Promise<{ user: User, membership: Membership }> {
  const user = requireUser(event)

  const [membership] = await useDb()
    .select()
    .from(memberships)
    .where(and(eq(memberships.tontineId, tontineId), eq(memberships.userId, user.id)))
    .limit(1)

  if (!membership) {
    // 404 et non 403 : révéler qu'une tontine existe à quelqu'un qui n'en est
    // pas membre est déjà une fuite d'information.
    throw apiError('NOT_FOUND', 'Tontine introuvable.')
  }

  if (membership.status !== 'active') {
    throw apiError('FORBIDDEN', 'Ton adhésion à cette tontine n’est pas active.')
  }

  if (rolesAutorises && !rolesAutorises.includes(membership.role)) {
    throw apiError('FORBIDDEN', `Cette action est réservée : ${libelleRoles(rolesAutorises)}.`)
  }

  return { user, membership }
}

/** Exige un palier KYC minimal, en indiquant lequel manque (docs/data-model.md §4). */
export function requireKyc(user: User, niveau: number): void {
  if (user.kycLevel < niveau) {
    throw apiError(
      'KYC_REQUIRED',
      niveau >= 2
        ? 'Cette action demande une pièce d’identité vérifiée.'
        : 'Complète ton nom pour continuer.',
      { requiredLevel: niveau },
    )
  }
}

const LIBELLES: Record<MembershipRole, string> = {
  president: 'le président',
  treasurer: 'le trésorier',
  auditor: 'le censeur',
  member: 'les membres',
}

function libelleRoles(roles: readonly MembershipRole[]): string {
  return roles.map(r => LIBELLES[r]).join(' ou ')
}
