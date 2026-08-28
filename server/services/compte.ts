import { and, eq, inArray, ne } from 'drizzle-orm'
import type { useDb } from '../db/index.ts'
import {
  contributions, memberships, rounds, shares, tontines, users,
} from '../db/schema.ts'

type Db = ReturnType<typeof useDb>

export interface BlocageSuppression {
  tontineId: string
  tontineName: string
  /** Ce qui bloque, dit en clair au membre. */
  raison: string
  roundIndex?: number
}

/**
 * Ce qui empêche la suppression d'un compte.
 *
 * docs/api-contract.md est explicite : « **renvoyer la liste des blocages, pas
 * un refus opaque** ». Quelqu'un qui veut partir a le droit de savoir
 * exactement ce qui le retient, et de pouvoir agir dessus. Un « impossible »
 * sans explication, sur une application d'argent partagé, se lit comme une
 * séquestration.
 *
 * Deux motifs bloquent :
 * - un tour en cours dans une tontine où le membre est actif : son absence
 *   fausserait le pot des autres ;
 * - un tour où il n'a pas encore pris la main : partir maintenant, c'est avoir
 *   cotisé pour rien.
 */
export function blocagesSuppression(db: Db, userId: string): BlocageSuppression[] {
  const adhesions = db
    .select({
      membershipId: memberships.id,
      tontineId: memberships.tontineId,
      tontineName: tontines.name,
      tontineStatus: tontines.status,
    })
    .from(memberships)
    .innerJoin(tontines, eq(tontines.id, memberships.tontineId))
    .where(and(eq(memberships.userId, userId), eq(memberships.status, 'active')))
    .all()

  const blocages: BlocageSuppression[] = []

  for (const a of adhesions) {
    if (a.tontineStatus !== 'running') continue

    const toursEnCours = db
      .select({ index: rounds.index, status: rounds.status })
      .from(rounds)
      .where(and(
        eq(rounds.tontineId, a.tontineId),
        inArray(rounds.status, ['collecting', 'payout_pending']),
      ))
      .all()

    for (const tour of toursEnCours) {
      blocages.push({
        tontineId: a.tontineId,
        tontineName: a.tontineName,
        roundIndex: tour.index,
        raison: tour.status === 'collecting'
          ? `Le tour ${tour.index} est en cours de cotisation.`
          : `Le pot du tour ${tour.index} n’a pas encore été versé.`,
      })
    }

    // Parts pas encore servies : le membre a cotisé sans avoir pris la main.
    const partsRestantes = db
      .select({ id: shares.id })
      .from(shares)
      .innerJoin(rounds, eq(rounds.beneficiaryShareId, shares.id))
      .where(and(eq(shares.membershipId, a.membershipId), ne(rounds.status, 'closed')))
      .all()

    if (partsRestantes.length > 0 && toursEnCours.length === 0) {
      blocages.push({
        tontineId: a.tontineId,
        tontineName: a.tontineName,
        raison: 'Tu n’as pas encore pris la main dans cette tontine.',
      })
    }
  }

  return blocages
}

/**
 * Export des données personnelles — loi ivoirienne n° 2013-450.
 *
 * Contient ce qui concerne la personne, et **rien sur les autres membres** :
 * ses adhésions, ses cotisations, ses déclarations. Pas la liste du groupe, pas
 * les montants dus par les autres. Un export de données ne doit pas devenir un
 * moyen d'aspirer le carnet d'adresses d'une tontine.
 */
export function exporterDonnees(db: Db, userId: string) {
  const [utilisateur] = db.select().from(users).where(eq(users.id, userId)).limit(1).all()

  const adhesions = db
    .select({
      tontineId: memberships.tontineId,
      tontineName: tontines.name,
      role: memberships.role,
      status: memberships.status,
      joinedAt: memberships.joinedAt,
    })
    .from(memberships)
    .innerJoin(tontines, eq(tontines.id, memberships.tontineId))
    .where(eq(memberships.userId, userId))
    .all()

  const mesCotisations = db
    .select({
      tontineId: rounds.tontineId,
      roundIndex: rounds.index,
      expectedAmount: contributions.expectedAmount,
      confirmedAmount: contributions.confirmedAmount,
      status: contributions.status,
      dueDate: contributions.dueDate,
    })
    .from(contributions)
    .innerJoin(memberships, eq(memberships.id, contributions.membershipId))
    .innerJoin(rounds, eq(rounds.id, contributions.roundId))
    .where(eq(memberships.userId, userId))
    .all()

  return {
    exportedAt: new Date().toISOString(),
    profil: {
      phone: utilisateur?.phone,
      firstName: utilisateur?.firstName,
      lastName: utilisateur?.lastName,
      kycLevel: utilisateur?.kycLevel,
      createdAt: utilisateur?.createdAt,
      consentDataAt: utilisateur?.consentDataAt,
      consentNotificationsAt: utilisateur?.consentNotificationsAt,
    },
    adhesions,
    cotisations: mesCotisations,
  }
}
