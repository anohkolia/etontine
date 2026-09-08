import { randomUUID } from 'node:crypto'
import { asc, eq } from 'drizzle-orm'
import type { useDb } from '../db/index.ts'
import { contributions, memberships, rounds, shares, tontines, users } from '../db/schema.ts'
import type { frequency } from '../../shared/schemas/index.ts'
import type { z } from 'zod'
import { apiError } from '../utils/errors.ts'
import { assertTransition } from '../utils/transitions.ts'
import { appendLedger } from './ledger.ts'
import { notifierTontine } from './notifications.ts'
import { comptesActifs } from './membres.ts'

type Db = ReturnType<typeof useDb>
type Frequence = z.infer<typeof frequency>

/** Nombre minimal d'adhésions actives pour démarrer (docs/data-model.md §2.1). */
export const MEMBRES_MINIMUM = 3

/**
 * Date d'un tour, à partir de la date de départ et du rang du tour.
 *
 * Le mensuel ne s'additionne pas en jours : le 31 janvier + un mois doit tomber
 * fin février, pas le 3 mars. `setMonth` sur une date au 31 déborde ; on ramène
 * donc au dernier jour du mois visé. Sans cela, une tontine démarrée un 31
 * dériverait d'un jour ou trois à chaque tour.
 */
export function dateDuTour(depart: string, index: number, frequence: Frequence): string {
  const base = new Date(`${depart}T00:00:00Z`)
  const rang = index - 1

  if (frequence === 'monthly') {
    const jour = base.getUTCDate()
    const cible = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + rang, 1))
    const dernierJour = new Date(Date.UTC(cible.getUTCFullYear(), cible.getUTCMonth() + 1, 0)).getUTCDate()
    cible.setUTCDate(Math.min(jour, dernierJour))
    return cible.toISOString().slice(0, 10)
  }

  const jours = { daily: 1, weekly: 7, biweekly: 14 }[frequence]
  const resultat = new Date(base)
  resultat.setUTCDate(resultat.getUTCDate() + rang * jours)
  return resultat.toISOString().slice(0, 10)
}

export interface ResultatDemarrage {
  rounds: number
  contributions: number
  expectedAmount: number
}

/**
 * Démarre la tontine : `open → running`.
 *
 * Fige l'ordre de passage, puis **génère tous les tours et toutes les
 * cotisations d'un coup**. Les générer à l'avance plutôt qu'au fil de l'eau
 * rend le calendrier lisible dès le premier jour : chacun sait quand il prendra
 * la main, et le registre porte l'engagement complet.
 *
 * Deux règles de calcul se jouent ici, et ce sont les plus faciles à rater :
 *
 * 1. **Un tour par part**, pas par membre. Un membre à deux parts prend la main
 *    deux fois, à deux tours distincts.
 * 2. **Le bénéficiaire cotise aussi.** C'est l'usage ivoirien : le net lui
 *    revient au versement. L'exclure fausserait le pot de tout le monde.
 */
export function demarrerTontine(db: Db, tontineId: string, acteurId: string): ResultatDemarrage {
  const [tontine] = db.select().from(tontines).where(eq(tontines.id, tontineId)).limit(1).all()
  if (!tontine) throw apiError('NOT_FOUND', 'Tontine introuvable.')

  assertTransition('tontine', tontine.status, 'running')

  const actifs = comptesActifs(db, tontineId)
  if (actifs < MEMBRES_MINIMUM) {
    throw apiError(
      'FORBIDDEN',
      `Il faut au moins ${MEMBRES_MINIMUM} membres actifs pour démarrer. Il y en a ${actifs}.`,
      { field: 'members' },
    )
  }

  const parts = db
    .select()
    .from(shares)
    .where(eq(shares.tontineId, tontineId))
    .orderBy(asc(shares.rotationPosition))
    .all()

  if (parts.length === 0) {
    throw apiError('FORBIDDEN', 'Aucune part n’est attribuée.', { field: 'shares' })
  }

  // Le pot attendu se calcule une fois, sur le total des parts : c'est la même
  // valeur pour tous les tours, bénéficiaire compris.
  const potAttendu = tontine.shareAmount * parts.length

  let nbCotisations = 0

  for (const [i, part] of parts.entries()) {
    const index = i + 1
    const echeance = dateDuTour(tontine.startDate, index, tontine.frequency)
    const roundId = randomUUID()

    db.insert(rounds).values({
      id: roundId,
      tontineId,
      index,
      dueDate: echeance,
      beneficiaryShareId: part.id,
      expectedAmount: potAttendu,
      // Seul le premier tour s'ouvre : les suivants attendent leur date (T13).
      status: index === 1 ? 'collecting' : 'pending',
    }).run()

    for (const cotisante of parts) {
      db.insert(contributions).values({
        id: randomUUID(),
        roundId,
        shareId: cotisante.id,
        membershipId: cotisante.membershipId,
        expectedAmount: tontine.shareAmount,
        confirmedAmount: 0,
        status: 'due',
        dueDate: echeance,
      }).run()
      nbCotisations++
    }
  }

  db.update(tontines)
    .set({ status: 'running', rotationFrozenAt: new Date() })
    .where(eq(tontines.id, tontineId))
    .run()

  appendLedger(db, {
    tontineId,
    type: 'settings_changed',
    actorId: acteurId,
    payload: {
      changement: 'demarrage',
      rounds: parts.length,
      shares: parts.length,
      // Le montant attendu par tour est consigné : c'est l'engagement du groupe.
      expectedAmountPerRound: potAttendu,
      rotation: parts.map(p => p.id),
    },
  })

  return { rounds: parts.length, contributions: nbCotisations, expectedAmount: potAttendu }
}

/**
 * Les tours d'une tontine, du premier au dernier.
 *
 * Le nom du bénéficiaire vient du compte quand il y en a un. Ne lire que
 * `managed_name` laissait sans nom tous ceux qui sont arrivés par lien — et sur
 * un calendrier de passage, une ligne sans nom ne répond pas à la question
 * qu'on vient y poser.
 */
export function toursDe(db: Db, tontineId: string) {
  return db
    .select({
      id: rounds.id,
      index: rounds.index,
      dueDate: rounds.dueDate,
      status: rounds.status,
      expectedAmount: rounds.expectedAmount,
      beneficiaryShareId: rounds.beneficiaryShareId,
      beneficiaryMembershipId: shares.membershipId,
      managedName: memberships.managedName,
      firstName: users.firstName,
      lastName: users.lastName,
      beneficiaryUserId: memberships.userId,
    })
    .from(rounds)
    .innerJoin(shares, eq(shares.id, rounds.beneficiaryShareId))
    .innerJoin(memberships, eq(memberships.id, shares.membershipId))
    .leftJoin(users, eq(users.id, memberships.userId))
    .where(eq(rounds.tontineId, tontineId))
    .orderBy(asc(rounds.index))
    .all()
    .map(t => ({
      ...t,
      beneficiaryName: [t.firstName, t.lastName].filter(Boolean).join(' ') || t.managedName || 'Membre',
    }))
}

/**
 * Où en est un tour, pour un membre donné.
 *
 * Le calcul vivait en clair dans `tableau-de-bord.ts`. L'écran de détail d'une
 * tontine a besoin des mêmes chiffres : le recopier serait deux
 * implémentations du même calcul d'argent, et rien ne garantirait qu'elles
 * disent la même chose au même moment. Elles vivent donc ici, une fois.
 *
 * `miennes` est renvoyé avec le reste parce que le tableau de bord s'en sert
 * pour construire sa liste « à traiter » — le lui faire relire séparément
 * doublerait la requête.
 */
export interface EtatDuTour {
  /** Somme des montants **confirmés** du tour. Une déclaration ne compte pas. */
  potCollected: number
  /** Ce qu'il reste à verser pour ce membre, toutes ses parts additionnées. */
  myRemaining: number
  myContributionStatus: string | null
  miennes: Array<typeof contributions.$inferSelect>
}

export function etatDuTour(db: Db, roundId: string, membershipId: string): EtatDuTour {
  const toutes = db
    .select()
    .from(contributions)
    .where(eq(contributions.roundId, roundId))
    .all()

  // Un membre à double part a plusieurs cotisations sur le même tour : on les
  // additionne, on n'en prend pas une au hasard.
  const miennes = toutes.filter(c => c.membershipId === membershipId)

  return {
    potCollected: toutes.reduce((n, c) => n + c.confirmedAmount, 0),
    myRemaining: miennes.reduce((n, c) => n + Math.max(0, c.expectedAmount - c.confirmedAmount), 0),
    myContributionStatus: miennes[0]?.status ?? null,
    miennes,
  }
}

/**
 * Clôt la tontine si son dernier tour vient de se fermer.
 *
 * Rien ne le faisait. `running → closed` figurait dans la table des
 * transitions, et aucun service, aucune route, aucune tâche ne l'empruntait :
 * une tontine allait au bout de ses douze tours et restait « en cours » pour
 * toujours. Deux conséquences, l'une visible et l'autre non — l'écran
 * annonçait un cycle qui continue alors qu'il n'y a plus rien à cotiser, et la
 * place restait comptée au quota d'abonnement du président, alors que le
 * contrat promet qu'elle se libère en closant une tontine.
 *
 * C'est **déduit**, pas décidé : quand tous les tours sont clos, il n'y a plus
 * rien à faire, et demander un geste de plus à l'organisateur pour constater
 * une évidence n'ajouterait qu'un oubli possible.
 */
export function cloturerSiDernierTour(db: Db, tontineId: string, acteurId: string): boolean {
  const tous = db
    .select({ status: rounds.status })
    .from(rounds)
    .where(eq(rounds.tontineId, tontineId))
    .all()

  if (tous.length === 0 || tous.some(r => r.status !== 'closed')) return false

  const [tontine] = db.select().from(tontines).where(eq(tontines.id, tontineId)).limit(1).all()
  if (!tontine || tontine.status !== 'running') return false

  assertTransition('tontine', tontine.status, 'closed')
  db.update(tontines).set({ status: 'closed' }).where(eq(tontines.id, tontineId)).run()

  appendLedger(db, {
    tontineId,
    type: 'settings_changed',
    actorId: acteurId,
    payload: { changement: 'cloture_tontine', tours: tous.length },
  })

  // Aucun montant : écran de verrouillage, téléphone partagé (règle 21).
  notifierTontine(db, tontineId, {
    type: 'tontine_terminee',
    title: 'Ta tontine est arrivée à son terme',
    body: 'Tous les tours sont clos. Le registre reste consultable.',
    url: `/app/tontine/${tontineId}/registre`,
  })

  return true
}
