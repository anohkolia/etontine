import { and, asc, eq, inArray, ne } from 'drizzle-orm'
import type { useDb } from '../db/index.ts'
import {
  contributions, memberships, paymentDeclarations, payouts, rounds, shares, tontines, users,
} from '../db/schema.ts'
import { etatDuTour } from './tours.ts'

type Db = ReturnType<typeof useDb>

export interface ATraiter {
  type: 'cotisation_due' | 'cotisation_retard' | 'confirmation_attente' | 'versement_a_faire' | 'accuse_a_poser'
  tontineId: string
  tontineName: string
  /** Ce qu'il y a à faire, dit en français, à la première personne. */
  libelle: string
  /** Combien d'éléments : deux cotisations pour un membre à double part. */
  nombre: number
  url: string
}

export interface TontineDuTableau {
  id: string
  name: string
  /** Icône choisie par le président, ou `null` — la carte retombe sur l'initiale. */
  emoji: string | null
  locality: string | null
  status: string
  myRole: string
  shareAmount: number
  frequency: string
  roundIndex: number | null
  nextDueDate: string | null
  /** Ce que j'ai à verser sur le tour courant, tout compris. */
  myRemaining: number
  myContributionStatus: string | null
  potCollected: number
  potExpected: number
  beneficiaryName: string | null
}

/** Une adhésion demandée, en attente de l'accord du président. */
export interface DemandeEnAttente {
  tontineId: string
  name: string
  emoji: string | null
  locality: string | null
}

export interface TableauDeBord {
  aTraiter: ATraiter[]
  tontines: TontineDuTableau[]
  demandes: DemandeEnAttente[]
}

function nomDe(l: { firstName: string | null, lastName: string | null, managedName: string | null }): string {
  return [l.firstName, l.lastName].filter(Boolean).join(' ') || l.managedName || 'Membre'
}

/**
 * Tout ce qu'il faut pour peindre le tableau de bord, **en un seul appel**.
 *
 * L'alternative — une requête par tontine, puis une par tour — donnerait dix
 * allers-retours sur un réseau où chacun coûte une seconde. Sur un téléphone
 * en 3G au marché, la différence n'est pas cosmétique : c'est un écran qui
 * s'affiche ou un membre qui referme l'application.
 *
 * Le bloc « à traiter aujourd'hui » vient **en premier** parce que c'est ce qui
 * remplace vraiment le carnet : pas l'historique, mais ce qu'il reste à faire.
 */
export function tableauDeBord(db: Db, userId: string): TableauDeBord {
  const adhesions = db
    .select({
      membershipId: memberships.id,
      role: memberships.role,
      tontine: tontines,
    })
    .from(memberships)
    .innerJoin(tontines, eq(tontines.id, memberships.tontineId))
    .where(and(
      eq(memberships.userId, userId),
      eq(memberships.status, 'active'),
      ne(tontines.status, 'archived'),
    ))
    .all()

  const aTraiter: ATraiter[] = []
  const resume: TontineDuTableau[] = []

  for (const a of adhesions) {
    const [tourCourant] = db
      .select()
      .from(rounds)
      .where(and(
        eq(rounds.tontineId, a.tontine.id),
        inArray(rounds.status, ['collecting', 'payout_pending']),
      ))
      .orderBy(asc(rounds.index))
      .limit(1)
      .all()

    let myRemaining = 0
    let myContributionStatus: string | null = null
    let potCollected = 0
    let beneficiaryName: string | null = null

    if (tourCourant) {
      // Le calcul vit dans `services/tours.ts` : l'écran de détail d'une
      // tontine affiche les mêmes chiffres, et deux implémentations d'un même
      // calcul d'argent finissent toujours par diverger.
      const etat = etatDuTour(db, tourCourant.id, a.membershipId)
      const miennes = etat.miennes

      potCollected = etat.potCollected
      myRemaining = etat.myRemaining
      myContributionStatus = etat.myContributionStatus

      const enRetard = miennes.filter(c => c.status === 'late')
      const dues = miennes.filter(c => c.status === 'due')

      if (enRetard.length > 0) {
        aTraiter.push({
          type: 'cotisation_retard',
          tontineId: a.tontine.id,
          tontineName: a.tontine.name,
          libelle: enRetard.length > 1
            ? `Tu as ${enRetard.length} cotisations en retard`
            : 'Tu as une cotisation en retard',
          nombre: enRetard.length,
          url: `/app/tontine/${a.tontine.id}/cotiser`,
        })
      }
      else if (dues.length > 0) {
        aTraiter.push({
          type: 'cotisation_due',
          tontineId: a.tontine.id,
          tontineName: a.tontine.name,
          libelle: dues.length > 1
            ? `${dues.length} cotisations à verser`
            : 'Une cotisation à verser',
          nombre: dues.length,
          url: `/app/tontine/${a.tontine.id}/cotiser`,
        })
      }

      const [beneficiaire] = db
        .select({
          managedName: memberships.managedName,
          firstName: users.firstName,
          lastName: users.lastName,
        })
        .from(shares)
        .innerJoin(memberships, eq(memberships.id, shares.membershipId))
        .leftJoin(users, eq(users.id, memberships.userId))
        .where(eq(shares.id, tourCourant.beneficiaryShareId))
        .limit(1)
        .all()

      beneficiaryName = beneficiaire ? nomDe(beneficiaire) : null

      // Le bureau : les déclarations qui attendent une décision.
      if (a.role === 'treasurer' || a.role === 'president') {
        const enAttente = db
          .select({ id: paymentDeclarations.id })
          .from(paymentDeclarations)
          .innerJoin(contributions, eq(contributions.id, paymentDeclarations.contributionId))
          .where(and(
            eq(contributions.roundId, tourCourant.id),
            eq(paymentDeclarations.decision, 'pending'),
            // Ses propres déclarations ne sont pas de son ressort.
            ne(paymentDeclarations.declaredBy, userId),
          ))
          .all()

        if (enAttente.length > 0) {
          aTraiter.push({
            type: 'confirmation_attente',
            tontineId: a.tontine.id,
            tontineName: a.tontine.name,
            libelle: enAttente.length > 1
              ? `${enAttente.length} déclarations à confirmer`
              : 'Une déclaration à confirmer',
            nombre: enAttente.length,
            url: `/app/tontine/${a.tontine.id}/confirmations`,
          })
        }

        const [versement] = db.select().from(payouts).where(eq(payouts.roundId, tourCourant.id)).limit(1).all()
        const potComplet = potCollected >= tourCourant.expectedAmount

        if (!versement && potComplet) {
          aTraiter.push({
            type: 'versement_a_faire',
            tontineId: a.tontine.id,
            tontineName: a.tontine.name,
            libelle: 'Le pot est complet : il reste à le verser',
            nombre: 1,
            url: `/app/tontine/${a.tontine.id}/versement`,
          })
        }
      }

      // Le bénéficiaire : le pot est parti, il doit en accuser réception.
      const [versementDeclare] = db
        .select()
        .from(payouts)
        .where(and(eq(payouts.roundId, tourCourant.id), eq(payouts.status, 'declared')))
        .limit(1)
        .all()

      if (versementDeclare?.beneficiaryMembershipId === a.membershipId) {
        aTraiter.push({
          type: 'accuse_a_poser',
          tontineId: a.tontine.id,
          tontineName: a.tontine.name,
          libelle: 'Confirme que tu as bien reçu le pot',
          nombre: 1,
          url: `/app/tontine/${a.tontine.id}/versement`,
        })
      }
    }

    resume.push({
      id: a.tontine.id,
      name: a.tontine.name,
      emoji: a.tontine.emoji,
      locality: a.tontine.locality,
      status: a.tontine.status,
      myRole: a.role,
      shareAmount: a.tontine.shareAmount,
      frequency: a.tontine.frequency,
      roundIndex: tourCourant?.index ?? null,
      nextDueDate: tourCourant?.dueDate ?? null,
      myRemaining,
      myContributionStatus,
      potCollected,
      potExpected: tourCourant?.expectedAmount ?? 0,
      beneficiaryName,
    })
  }

  // Les retards d'abord : c'est ce qui coince le groupe.
  const priorite: Record<ATraiter['type'], number> = {
    cotisation_retard: 0,
    accuse_a_poser: 1,
    versement_a_faire: 2,
    confirmation_attente: 3,
    cotisation_due: 4,
  }
  aTraiter.sort((a, b) => priorite[a.type] - priorite[b.type])

  /**
   * Les demandes d'adhésion en attente.
   *
   * Elles n'apparaissaient nulle part : la requête ci-dessus ne lit que les
   * adhésions **actives**. Quelqu'un qui rejoignait par lien lisait « ta demande
   * est envoyée », puis retrouvait un tableau de bord vide — aucune trace que
   * sa demande existe, ni qu'elle attend quelqu'un.
   *
   * Rien de financier n'en sort : tant que le président n'a pas donné son
   * accord, cette personne n'est pas du groupe, et le montant des cotisations
   * ne la regarde pas encore.
   */
  const demandes = db
    .select({
      tontineId: tontines.id,
      name: tontines.name,
      emoji: tontines.emoji,
      locality: tontines.locality,
    })
    .from(memberships)
    .innerJoin(tontines, eq(tontines.id, memberships.tontineId))
    .where(and(
      eq(memberships.userId, userId),
      eq(memberships.status, 'pending_approval'),
    ))
    .all()

  return { aTraiter, tontines: resume, demandes }
}
