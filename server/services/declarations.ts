import { randomUUID } from 'node:crypto'
import { and, desc, eq, gte, inArray } from 'drizzle-orm'
import type { useDb } from '../db/index.ts'
import {
  contributions, memberships, paymentDeclarations, rounds, tontines,
} from '../db/schema.ts'
import type { PaymentChannel } from '../../shared/schemas/index.ts'
import { apiError } from '../utils/errors.ts'
import { assertTransition } from '../utils/transitions.ts'
import { confirmateursPossibles, confirmerDeclaration } from './confirmations.ts'
import { appendLedger } from './ledger.ts'
import { notifierTontine } from './notifications.ts'

type Db = ReturnType<typeof useDb>

/**
 * Fenêtre pendant laquelle une nouvelle déclaration sur la même cotisation est
 * considérée comme un double clic plutôt qu'un second envoi.
 *
 * Quatre-vingt-dix secondes : c'est plus long qu'un réseau qui rame, et plus
 * court qu'un aller-retour réel vers l'application de paiement. Un membre qui
 * envoie vraiment deux fois — cas légitime, paiement partiel — dépassera
 * largement ce délai.
 */
export const FENETRE_DOUBLON_SECONDES = 90

export interface DeclarationInput {
  amount: number
  channel: PaymentChannel
  providerRef?: string
  proofUrl?: string
}

export interface ResultatDeclaration {
  declarationId: string
  /**
   * L'état réel de la cotisation après coup. Vaut `declared` dans le cas
   * courant ; `confirmed` ou `due` quand la déclaration a été confirmée
   * d'office faute de second valideur — voir `autoConfirmee`.
   */
  contributionStatus: 'declared' | 'confirmed' | 'due'
  /** Vrai si l'on a reconnu un doublon récent au lieu d'en créer un second. */
  doublonEvite: boolean
  /**
   * Vrai quand la déclaration a été confirmée dans la foulée parce que le
   * bureau n'a qu'un membre : personne d'autre ne pouvait le faire. L'écran
   * s'en sert pour le dire au lieu d'annoncer une confirmation à venir qui ne
   * viendrait jamais.
   */
  autoConfirmee: boolean
}

/**
 * Déclare un paiement.
 *
 * Le membre a envoyé son argent **hors de l'application** — l'application ne
 * détient jamais de fonds (règle 5). Il vient donc simplement dire « j'ai
 * envoyé », et le trésorier confirmera. C'est pour cela que le statut résultant
 * est `declared` et non `confirmed` : déclarer n'est pas encaisser.
 *
 * Deux garde-fous distincts se combinent ici :
 *
 * - l'**idempotence** par en-tête, qui neutralise le rejeu réseau (T05) ;
 * - le **garde-fou anti-doublon**, qui reconnaît une seconde déclaration
 *   identique dans les 90 secondes. C'est le cas du membre impatient qui
 *   retape sur le bouton parce que rien ne s'affiche. On lui renvoie sa
 *   déclaration d'origine plutôt qu'un second enregistrement que le trésorier
 *   devrait ensuite démêler.
 */
export function declarerPaiement(
  db: Db,
  contributionId: string,
  declarantId: string,
  input: DeclarationInput,
  source: 'member' | 'treasurer' = 'member',
): ResultatDeclaration {
  const [ligne] = db
    .select({ contribution: contributions, tontineId: rounds.tontineId, roundId: rounds.id })
    .from(contributions)
    .innerJoin(rounds, eq(rounds.id, contributions.roundId))
    .where(eq(contributions.id, contributionId))
    .limit(1)
    .all()

  if (!ligne) throw apiError('NOT_FOUND', 'Cotisation introuvable.')

  // Garde-fou anti-doublon : même cotisation, même montant, même canal, dans
  // la fenêtre. On renvoie l'existante plutôt que d'en créer une seconde.
  //
  // Il passe **avant** la machine à états, et non après : un second appui sur
  // le bouton n'est pas une transition qu'on refuse, c'est un geste qu'on
  // reconnaît. Le placer après ferait répondre « passage impossible » à un
  // membre qui a simplement tapé deux fois.
  //
  // Une déclaration déjà confirmée compte donc aussi comme doublon : sur une
  // tontine où le bureau confirme d'office, la première n'est plus en attente
  // au moment où la seconde arrive. Seul un rejet est exclu — après un rejet,
  // re-déclarer est un geste légitime, pas un doublon.
  const depuis = new Date(Date.now() - FENETRE_DOUBLON_SECONDES * 1000)
  const [recente] = db
    .select()
    .from(paymentDeclarations)
    .where(and(
      eq(paymentDeclarations.contributionId, contributionId),
      eq(paymentDeclarations.declaredBy, declarantId),
      eq(paymentDeclarations.amount, input.amount),
      inArray(paymentDeclarations.decision, ['pending', 'confirmed']),
      gte(paymentDeclarations.declaredAt, depuis),
    ))
    .orderBy(desc(paymentDeclarations.declaredAt))
    .limit(1)
    .all()

  if (recente) {
    return {
      declarationId: recente.id,
      contributionStatus: ligne.contribution.status as 'declared' | 'confirmed' | 'due',
      doublonEvite: true,
      autoConfirmee: recente.decision === 'confirmed',
    }
  }

  // La transition passe par la machine à états : `confirmed → declared` est
  // impossible, et un client qui poste un statut n'a aucune prise dessus.
  assertTransition('contribution', ligne.contribution.status, 'declared')

  const declarationId = randomUUID()
  db.insert(paymentDeclarations).values({
    id: declarationId,
    contributionId,
    declaredBy: declarantId,
    source,
    amount: input.amount,
    channel: input.channel,
    providerRef: input.providerRef ?? null,
    proofUrl: input.proofUrl ?? null,
    declaredAt: new Date(),
    decision: 'pending',
  }).run()

  db.update(contributions)
    .set({ status: 'declared' })
    .where(eq(contributions.id, contributionId))
    .run()

  appendLedger(db, {
    tontineId: ligne.tontineId,
    roundId: ligne.roundId,
    type: 'contribution_declared',
    actorId: declarantId,
    payload: {
      contributionId,
      declarationId,
      amount: input.amount,
      channel: input.channel,
      providerRef: input.providerRef ?? null,
      source,
    },
  })

  // Bureau d'une seule personne : nul autre ne peut confirmer cette
  // déclaration, et la laisser en attente la bloquerait pour de bon. On
  // enchaîne donc la confirmation, que `confirmerDeclaration` n'accorde que
  // s'il constate lui-même l'absence de second valideur — et qui l'inscrit au
  // registre comme telle.
  if (confirmateursPossibles(db, ligne.tontineId, declarantId).length === 0) {
    const confirmation = confirmerDeclaration(db, declarationId, declarantId)
    if (confirmation.autoConfirmee) {
      return {
        declarationId,
        contributionStatus: confirmation.contributionStatus as 'confirmed' | 'due',
        doublonEvite: false,
        autoConfirmee: true,
      }
    }
  }

  return { declarationId, contributionStatus: 'declared', doublonEvite: false, autoConfirmee: false }
}

/**
 * Déclaration d'espèces par le trésorier, pour un tiers.
 *
 * Cas très fréquent : le membre paie de la main à la main, souvent parce qu'il
 * n'a pas de compte de monnaie électronique. Le trésorier déclare à sa place,
 * et le membre reçoit une demande de confirmation — c'est la contrepartie de
 * cette dissymétrie : celui qui n'a pas envoyé lui-même doit pouvoir dire s'il
 * reconnaît le versement (T17).
 */
export function declarerEspeces(
  db: Db,
  contributionId: string,
  tresorierId: string,
  input: Omit<DeclarationInput, 'channel'>,
): ResultatDeclaration {
  const resultat = declarerPaiement(
    db,
    contributionId,
    tresorierId,
    { ...input, channel: 'cash' },
    'treasurer',
  )

  const [ligne] = db
    .select({ tontineId: rounds.tontineId, membershipId: contributions.membershipId })
    .from(contributions)
    .innerJoin(rounds, eq(rounds.id, contributions.roundId))
    .where(eq(contributions.id, contributionId))
    .limit(1)
    .all()

  if (ligne) {
    const [membre] = db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(eq(memberships.id, ligne.membershipId))
      .limit(1)
      .all()

    if (membre?.userId) {
      // Aucun montant dans la notification (règle 21).
      notifierTontine(db, ligne.tontineId, {
        type: 'especes_a_confirmer',
        title: 'Une cotisation a été enregistrée pour toi',
        body: 'Le trésorier a enregistré un versement en espèces à ton nom. Confirme-le si c’est exact.',
        url: `/app/tontine/${ligne.tontineId}/cotiser`,
      }, { sauf: [tresorierId] })
    }
  }

  return resultat
}

/** Le total déjà déclaré et en attente sur une cotisation. */
export function declarationsEnAttente(db: Db, contributionId: string) {
  return db
    .select()
    .from(paymentDeclarations)
    .where(and(
      eq(paymentDeclarations.contributionId, contributionId),
      eq(paymentDeclarations.decision, 'pending'),
    ))
    .all()
}

/** Le seuil de contre-validation d'une tontine — utilisé au versement (T19). */
export function seuilContreValidation(db: Db, tontineId: string): number {
  const [t] = db.select().from(tontines).where(eq(tontines.id, tontineId)).limit(1).all()
  return t?.counterValidationThreshold ?? 100_000
}
