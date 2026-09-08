import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import type { useDb } from '../db/index.ts'
import {
  contributions, memberships, payouts, rounds, shares, tontines, users,
} from '../db/schema.ts'
import type { PaymentChannel } from '../../shared/schemas/index.ts'
import { apiError } from '../utils/errors.ts'
import { assertTransition } from '../utils/transitions.ts'
import { appendLedger } from './ledger.ts'
import { notifier, notifierTontine } from './notifications.ts'
import { cloturerSiDernierTour } from './tours.ts'

type Db = ReturnType<typeof useDb>

/** Un numéro changé il y a moins de 48 h déclenche une alerte (règle 22). */
export const GEL_NUMERO_HEURES = 48

export interface EtatVersement {
  roundId: string
  roundIndex: number
  tontineId: string
  /** Ce qui a été réellement confirmé, calculé côté serveur. */
  collected: number
  expected: number
  /** Ce qui manque. Zéro si le pot est complet. */
  shortfall: number
  /** Les cotisations non soldées, pour que le bureau sache qui relancer. */
  missing: Array<{ membershipId: string, name: string, remaining: number }>
  beneficiary: {
    membershipId: string
    name: string
    msisdn: string | null
    /** Vrai si le numéro a changé il y a moins de 48 h. */
    phoneRecentlyChanged: boolean
    /**
     * A-t-il un compte ? Sans compte, il ne peut pas accuser réception — et
     * l'écran doit proposer au président la seule sortie qui reste plutôt que
     * d'annoncer une confirmation qui n'arrivera jamais.
     */
    hasAccount: boolean
  }
  counterValidationRequired: boolean
  counterValidationThreshold: number
  /**
   * Y a-t-il seulement quelqu'un pour contre-valider ? Faux quand le bureau se
   * réduit à celui qui a préparé — le tour où le président est lui-même le
   * bénéficiaire d'une tontine qu'il tient seul. L'écran doit le dire, sinon
   * il affiche un bouton que personne ne peut presser.
   */
  counterValidationPossible: boolean
  /** L'appelant peut-il contre-valider maintenant ? */
  canCounterValidate: boolean
  payout: typeof payouts.$inferSelect | null
}

function contexteTour(db: Db, roundId: string) {
  const [ligne] = db
    .select({
      round: rounds,
      tontine: tontines,
      beneficiaryMembershipId: shares.membershipId,
    })
    .from(rounds)
    .innerJoin(tontines, eq(tontines.id, rounds.tontineId))
    .innerJoin(shares, eq(shares.id, rounds.beneficiaryShareId))
    .where(eq(rounds.id, roundId))
    .limit(1)
    .all()

  if (!ligne) throw apiError('NOT_FOUND', 'Tour introuvable.')
  return ligne
}

/**
 * Qui peut contre-valider le versement d'un tour.
 *
 * Le bureau — président et censeur — **et le bénéficiaire du tour**, dès lors
 * qu'il a un compte. L'ouvrir au bénéficiaire n'est pas un assouplissement :
 * c'est la personne qui peut réellement vérifier quelque chose. Elle lit le
 * montant annoncé et les quatre derniers chiffres de son propre numéro avant
 * que l'argent parte, et c'est elle qui perd si l'un des deux est faux. Sans
 * elle, une tontine dont le bureau tient en une personne n'aurait aucun
 * second acteur, et tout pot dépassant le seuil resterait bloqué.
 *
 * Le préparateur en est toujours exclu : deux paires d'yeux, jamais deux fois
 * les mêmes (docs/data-model.md §2.5).
 */
export function contreValidateursPossibles(
  db: Db,
  roundId: string,
  preparateurId?: string | null,
): string[] {
  const { round, beneficiaryMembershipId } = contexteTour(db, roundId)

  const bureau = db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(
      eq(memberships.tontineId, round.tontineId),
      eq(memberships.status, 'active'),
      inArray(memberships.role, ['president', 'auditor']),
    ))
    .all()
    .map(m => m.userId)

  const [beneficiaire] = db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(eq(memberships.id, beneficiaryMembershipId))
    .limit(1)
    .all()

  const candidats = new Set([...bureau, beneficiaire?.userId ?? null])
  candidats.delete(null)
  if (preparateurId) candidats.delete(preparateurId)

  return [...candidats] as string[]
}

/**
 * État du pot, prêt pour l'écran de préparation.
 *
 * Le pot **constitué** n'est pas le pot attendu : c'est la somme de ce qui a
 * été réellement confirmé. Afficher l'attendu comme s'il était acquis ferait
 * verser au bénéficiaire un montant que la tontine n'a pas.
 */
export function etatVersement(db: Db, roundId: string, acteurId?: string): EtatVersement {
  const { round, tontine, beneficiaryMembershipId } = contexteTour(db, roundId)

  const lignes = db
    .select({
      contribution: contributions,
      membershipId: memberships.id,
      managedName: memberships.managedName,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(contributions)
    .innerJoin(memberships, eq(memberships.id, contributions.membershipId))
    .leftJoin(users, eq(users.id, memberships.userId))
    .where(eq(contributions.roundId, roundId))
    .all()

  const collected = lignes.reduce((n, l) => n + l.contribution.confirmedAmount, 0)
  const missing = lignes
    .filter(l => l.contribution.confirmedAmount < l.contribution.expectedAmount)
    .map(l => ({
      membershipId: l.membershipId,
      name: [l.firstName, l.lastName].filter(Boolean).join(' ') || l.managedName || 'Membre',
      remaining: l.contribution.expectedAmount - l.contribution.confirmedAmount,
    }))

  const [beneficiaire] = db
    .select({
      userId: memberships.userId,
      managedName: memberships.managedName,
      managedPhone: memberships.managedPhone,
      firstName: users.firstName,
      lastName: users.lastName,
      phone: users.phone,
      phoneChangedAt: users.phoneChangedAt,
    })
    .from(memberships)
    .leftJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.id, beneficiaryMembershipId))
    .limit(1)
    .all()

  // Un numéro changé récemment est le signal d'un détournement par prise de
  // contrôle de compte : on ne bloque pas, on **alerte**, et le bureau vérifie
  // de vive voix avant d'envoyer le pot.
  const phoneRecentlyChanged = Boolean(
    beneficiaire?.phoneChangedAt
    && Date.now() - beneficiaire.phoneChangedAt.getTime() < GEL_NUMERO_HEURES * 3_600_000,
  )

  const [versement] = db.select().from(payouts).where(eq(payouts.roundId, roundId)).limit(1).all()
  const possibles = contreValidateursPossibles(db, roundId, versement?.preparedBy)

  return {
    roundId,
    roundIndex: round.index,
    tontineId: round.tontineId,
    collected,
    expected: round.expectedAmount,
    shortfall: Math.max(0, round.expectedAmount - collected),
    missing,
    beneficiary: {
      membershipId: beneficiaryMembershipId,
      name: [beneficiaire?.firstName, beneficiaire?.lastName].filter(Boolean).join(' ')
        || beneficiaire?.managedName
        || 'Membre',
      msisdn: beneficiaire?.phone ?? beneficiaire?.managedPhone ?? null,
      phoneRecentlyChanged,
      hasAccount: Boolean(beneficiaire?.userId),
    },
    counterValidationRequired: collected > tontine.counterValidationThreshold,
    counterValidationThreshold: tontine.counterValidationThreshold,
    counterValidationPossible: possibles.length > 0,
    canCounterValidate: Boolean(
      acteurId
      && versement?.status === 'prepared'
      && collected > tontine.counterValidationThreshold
      && possibles.includes(acteurId),
    ),
    payout: versement ?? null,
  }
}

export interface PreparationInput {
  /** Les quatre derniers chiffres du numéro du bénéficiaire, ressaisis. */
  beneficiaryPhoneLast4: string
  /** Le président assume un pot incomplet. Le manquant part au registre. */
  acceptIncompletePot: boolean
}

/**
 * Prépare le versement.
 *
 * La **ressaisie des quatre derniers chiffres** n'est pas une formalité : c'est
 * le seul garde-fou contre l'envoi au mauvais numéro, et contre un changement
 * de numéro passé inaperçu. Celui qui prépare doit avoir le bénéficiaire au
 * téléphone ou sous les yeux, pas seulement une ligne dans une liste.
 */
export function preparerVersement(
  db: Db,
  roundId: string,
  acteurId: string,
  input: PreparationInput,
) {
  const { round } = contexteTour(db, roundId)
  const etat = etatVersement(db, roundId)

  if (etat.payout) {
    throw apiError('INVALID_TRANSITION', 'Un versement est déjà préparé pour ce tour.', { field: 'status' })
  }

  if (round.status !== 'collecting' && round.status !== 'payout_pending') {
    throw apiError('INVALID_TRANSITION', 'Ce tour n’est pas en cours.', { field: 'status' })
  }

  const attendus = etat.beneficiary.msisdn?.slice(-4) ?? ''
  if (!attendus || attendus !== input.beneficiaryPhoneLast4) {
    throw apiError(
      'VALIDATION_ERROR',
      'Ces quatre chiffres ne correspondent pas au numéro du bénéficiaire.',
      { field: 'beneficiaryPhoneLast4' },
    )
  }

  if (etat.collected <= 0) {
    // Verser un pot vide n'a aucun sens : ce n'est pas un versement incomplet
    // que le président assume, c'est un tour où personne n'a encore cotisé.
    // Le laisser passer produirait un versement à zéro au registre, et un
    // bénéficiaire à qui l'on demanderait d'accuser réception de rien.
    throw apiError(
      'FORBIDDEN',
      'Aucune cotisation n’est encore confirmée : il n’y a rien à verser.',
      { field: 'collected' },
    )
  }

  if (etat.shortfall > 0 && !input.acceptIncompletePot) {
    throw apiError(
      'FORBIDDEN',
      'Le pot n’est pas complet. Le président peut forcer le versement en assumant le manquant.',
      { field: 'acceptIncompletePot' },
    )
  }

  if (round.status === 'collecting') {
    assertTransition('round', round.status, 'payout_pending')
    db.update(rounds).set({ status: 'payout_pending' }).where(eq(rounds.id, roundId)).run()
  }

  const payoutId = randomUUID()
  db.insert(payouts).values({
    id: payoutId,
    roundId,
    beneficiaryMembershipId: etat.beneficiary.membershipId,
    // Le montant versé est ce qui est **réellement** dans le pot.
    amount: etat.collected,
    shortfallAmount: etat.shortfall,
    preparedBy: acteurId,
    status: 'prepared',
  }).run()

  if (etat.shortfall > 0) {
    // Le manquant est écrit au registre, pas masqué : le bénéficiaire touche
    // moins que prévu, et le groupe doit pouvoir le constater.
    appendLedger(db, {
      tontineId: etat.tontineId,
      roundId,
      type: 'settings_changed',
      actorId: acteurId,
      payload: {
        changement: 'pot_incomplet_assume',
        collected: etat.collected,
        expected: etat.expected,
        shortfall: etat.shortfall,
        missing: etat.missing.map(m => ({ membershipId: m.membershipId, remaining: m.remaining })),
      },
    })
  }

  return {
    payoutId,
    amount: etat.collected,
    shortfall: etat.shortfall,
    counterValidationRequired: etat.counterValidationRequired,
  }
}

/**
 * Contre-validation, requise au-delà du seuil de la tontine.
 *
 * L'acteur doit être **différent** de celui qui a préparé (docs/data-model.md
 * §2.5). Deux paires d'yeux sur un gros versement, c'est ce qui distingue une
 * erreur rattrapable d'un détournement.
 *
 * Qui a le droit est décidé par `contreValidateursPossibles` : le bureau, et
 * le bénéficiaire du tour — celui qui a le plus à perdre si le montant ou le
 * numéro est faux, et le seul second acteur disponible quand l'organisateur
 * tient la tontine seul.
 */
export function contreValiderVersement(db: Db, roundId: string, acteurId: string) {
  const [versement] = db.select().from(payouts).where(eq(payouts.roundId, roundId)).limit(1).all()
  if (!versement) throw apiError('NOT_FOUND', 'Aucun versement préparé pour ce tour.')

  assertTransition('payout', versement.status, 'counter_validated')

  if (versement.preparedBy === acteurId) {
    throw apiError(
      'FORBIDDEN',
      'La contre-validation doit venir de quelqu’un d’autre que celui qui a préparé le versement.',
    )
  }

  if (!contreValidateursPossibles(db, roundId, versement.preparedBy).includes(acteurId)) {
    throw apiError(
      'FORBIDDEN',
      'Cette contre-validation est réservée au président, au censeur ou au bénéficiaire du tour.',
    )
  }

  db.update(payouts)
    .set({ status: 'counter_validated', counterValidatedBy: acteurId })
    .where(eq(payouts.id, versement.id))
    .run()

  return { payoutId: versement.id, status: 'counter_validated' as const }
}

/** Déclare que le pot a été envoyé au bénéficiaire. */
export function declarerVersement(
  db: Db,
  roundId: string,
  acteurId: string,
  input: { channel: PaymentChannel, providerRef?: string, proofUrl?: string },
) {
  const [versement] = db.select().from(payouts).where(eq(payouts.roundId, roundId)).limit(1).all()
  if (!versement) throw apiError('NOT_FOUND', 'Aucun versement préparé pour ce tour.')

  const etat = etatVersement(db, roundId)

  // Au-delà du seuil, la contre-validation est un passage obligé : on ne peut
  // pas déclarer directement depuis `prepared`.
  //
  // Sauf s'il n'existe personne pour la donner — le tour où le président est
  // lui-même le bénéficiaire d'une tontine qu'il tient seul. Bloquer là
  // gèlerait le pot pour de bon, et un pot gelé fait plus de dégâts qu'un
  // versement vu par une seule personne. On laisse donc passer, et le registre
  // porte que le contrôle n'a pas eu lieu : le groupe doit pouvoir le lire.
  const contreValidationImpossible = contreValidateursPossibles(db, roundId, versement.preparedBy).length === 0

  if (etat.counterValidationRequired && versement.status === 'prepared' && !contreValidationImpossible) {
    throw apiError(
      'FORBIDDEN',
      'Ce montant demande une contre-validation avant d’être versé.',
      { field: 'status' },
    )
  }

  assertTransition('payout', versement.status, 'declared')

  db.update(payouts)
    .set({
      status: 'declared',
      declaredBy: acteurId,
      channel: input.channel,
      providerRef: input.providerRef ?? null,
      proofUrl: input.proofUrl ?? null,
    })
    .where(eq(payouts.id, versement.id))
    .run()

  appendLedger(db, {
    tontineId: etat.tontineId,
    roundId,
    type: 'payout_declared',
    actorId: acteurId,
    payload: {
      payoutId: versement.id,
      amount: versement.amount,
      shortfall: versement.shortfallAmount,
      channel: input.channel,
      beneficiaryMembershipId: versement.beneficiaryMembershipId,
      // Écrit seulement là où il veut dire quelque chose : un versement au-delà
      // du seuil que personne n'a pu contre-valider.
      ...(etat.counterValidationRequired && contreValidationImpossible
        ? { contreValidationImpossible: true }
        : {}),
    },
  })

  notifierTontine(db, etat.tontineId, {
    type: 'pot_verse',
    title: 'Le pot du tour a été versé',
    body: 'Le versement est déclaré. Le bénéficiaire doit maintenant en accuser réception.',
    url: `/app/tontine/${etat.tontineId}/registre`,
  })

  return { payoutId: versement.id, status: 'declared' as const }
}

/**
 * Accusé de réception — **par le bénéficiaire seul**.
 *
 * C'est la seule preuve que l'argent est bien arrivé. Sans elle, la parole du
 * trésorier suffirait à clore un tour, ce qui reviendrait à lui demander de se
 * délivrer un quitus à lui-même. **Le tour ne se clôt pas sans cet accusé.**
 */
export function accuserReception(
  db: Db,
  roundId: string,
  acteurId: string,
  receivedAmount: number,
) {
  const [versement] = db.select().from(payouts).where(eq(payouts.roundId, roundId)).limit(1).all()
  if (!versement) throw apiError('NOT_FOUND', 'Aucun versement pour ce tour.')

  const [beneficiaire] = db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(eq(memberships.id, versement.beneficiaryMembershipId))
    .limit(1)
    .all()

  if (!beneficiaire?.userId || beneficiaire.userId !== acteurId) {
    throw apiError(
      'FORBIDDEN',
      'Seul le bénéficiaire du tour peut accuser réception du pot.',
    )
  }

  assertTransition('payout', versement.status, 'acknowledged')

  const maintenant = new Date()
  db.update(payouts)
    .set({ status: 'acknowledged', acknowledgedAt: maintenant })
    .where(eq(payouts.id, versement.id))
    .run()

  const { round } = contexteTour(db, roundId)
  assertTransition('round', round.status, 'closed')
  db.update(rounds).set({ status: 'closed', closedAt: maintenant }).where(eq(rounds.id, roundId)).run()

  appendLedger(db, {
    tontineId: round.tontineId,
    roundId,
    type: 'payout_acknowledged',
    actorId: acteurId,
    payload: {
      payoutId: versement.id,
      declaredAmount: versement.amount,
      // Le montant ressaisi par le bénéficiaire : un écart est un signal.
      receivedAmount,
      ecart: receivedAmount - versement.amount,
    },
  })

  const [president] = db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.tontineId, round.tontineId), eq(memberships.role, 'president')))
    .limit(1)
    .all()

  if (president?.userId) {
    notifier(db, president.userId, {
      type: 'pot_recu',
      tontineId: round.tontineId,
      title: 'Le pot a bien été reçu',
      body: 'Le bénéficiaire a accusé réception. Le tour est clos.',
      url: `/app/tontine/${round.tontineId}/registre`,
    })
  }

  // Dernier tour du cycle : la tontine s'achève avec lui. Après l'écriture du
  // tour, jamais avant — le registre se lit dans l'ordre où les choses se sont
  // produites, et la fin du cycle vient après la fin du dernier tour.
  const tontineClose = cloturerSiDernierTour(db, round.tontineId, acteurId)

  return {
    payoutId: versement.id,
    status: 'acknowledged' as const,
    roundClosed: true,
    tontineClosed: tontineClose,
    ecart: receivedAmount - versement.amount,
  }
}

/**
 * Clôture forcée d'un tour, sans accusé de réception.
 *
 * §2.3 pose la règle : **pas de clôture sans accusé du bénéficiaire.** Elle a
 * une bonne raison — sans elle, la parole du trésorier suffirait à clore un
 * tour, ce qui revient à lui demander de se délivrer un quitus à lui-même.
 *
 * Mais elle avait un trou : `accuserReception` exige un compte, et le
 * bénéficiaire d'un tour est très souvent un **membre géré**, saisi à la main
 * par le bureau, sans application. Il ne pouvait donc jamais accuser réception.
 * Le tour restait ouvert, `ouvrirTourSuivant` n'en ouvrait aucun autre tant
 * qu'un tour est en cours, et la tontine entière se figeait au premier
 * bénéficiaire sans compte. Le pot était parti, l'argent reçu, et
 * l'application refusait d'en tenir compte.
 *
 * D'où cette sortie, prévue au contrat et réservée au président. Elle ne ment
 * pas : le versement **reste** `declared`, personne n'a accusé réception, et
 * le registre porte le motif, l'auteur, et si le bénéficiaire avait seulement
 * les moyens de le faire. La règle tient, l'exception est tracée.
 */
export function cloturerTourSansAccuse(
  db: Db,
  roundId: string,
  acteurId: string,
  motif: string,
) {
  if (!motif || motif.trim().length < 5) {
    throw apiError(
      'VALIDATION_ERROR',
      'Explique pourquoi le tour est clos sans accusé de réception.',
      { field: 'reason' },
    )
  }

  const { round } = contexteTour(db, roundId)
  const [versement] = db.select().from(payouts).where(eq(payouts.roundId, roundId)).limit(1).all()

  if (!versement || versement.status !== 'declared') {
    // Clore avant que le pot soit parti n'est pas une exception, c'est une
    // perte : le bénéficiaire n'aurait rien reçu et n'aurait plus de tour.
    throw apiError(
      'INVALID_TRANSITION',
      'Le pot doit avoir été déclaré envoyé avant de clore le tour sans accusé.',
      { field: 'status' },
    )
  }

  assertTransition('round', round.status, 'closed')

  const [beneficiaire] = db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(eq(memberships.id, versement.beneficiaryMembershipId))
    .limit(1)
    .all()

  const maintenant = new Date()
  db.update(rounds).set({ status: 'closed', closedAt: maintenant }).where(eq(rounds.id, roundId)).run()

  appendLedger(db, {
    tontineId: round.tontineId,
    roundId,
    type: 'settings_changed',
    actorId: acteurId,
    payload: {
      changement: 'cloture_sans_accuse',
      payoutId: versement.id,
      amount: versement.amount,
      motif: motif.trim(),
      // Un bénéficiaire sans compte ne *pouvait pas* accuser réception ; un
      // bénéficiaire qui en a un ne l'a pas fait. Le registre distingue les
      // deux, parce que ce n'est pas la même histoire.
      beneficiairePouvaitAccuser: Boolean(beneficiaire?.userId),
    },
  })

  notifierTontine(db, round.tontineId, {
    type: 'tour_clos',
    title: 'Le tour a été clos par le président',
    body: 'Le tour est clos sans accusé de réception. Le motif est inscrit au registre.',
    url: `/app/tontine/${round.tontineId}/registre`,
  })

  // Un tour forcé reste un tour clos : si c'était le dernier, le cycle est fini.
  const tontineClose = cloturerSiDernierTour(db, round.tontineId, acteurId)

  return {
    roundId,
    status: 'closed' as const,
    payoutStatus: versement.status,
    tontineClosed: tontineClose,
  }
}
