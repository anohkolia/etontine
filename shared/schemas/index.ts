import { z } from 'zod'
import { PAID_TIERS, PLAN_PERIODICITIES, PLAN_TIERS } from '../constants/abonnement.ts'
import { TONTINE_EMOJIS } from '../constants/tontine.ts'

/* ------------------------------------------------------------------ */
/* Primitives métier                                                   */
/* ------------------------------------------------------------------ */

/**
 * Montant en FCFA. Entier strict, jamais de flottant, jamais de centimes.
 * Plafond de garde à 100 000 000 pour attraper les erreurs de saisie.
 */
export const amountFcfa = z
  .number()
  .int('Le montant doit être un nombre entier de FCFA')
  .positive()
  .max(100_000_000)

/**
 * Numéro ivoirien. Préfixes mobiles : 01 (Moov), 05 (MTN), 07 (Orange).
 * Accepte les saisies locales et normalise en E.164.
 */
export const phoneCI = z
  .string()
  .trim()
  .transform(v => v.replace(/[\s.\-()]/g, ''))
  .refine(v => /^(\+225)?0[157]\d{8}$/.test(v), {
    message: 'Numéro ivoirien invalide (doit commencer par 01, 05 ou 07)',
  })
  .transform(v => (v.startsWith('+225') ? v : `+225${v}`))

export const otpCode = z.string().regex(/^\d{6}$/, 'Le code doit contenir 6 chiffres')
export const shortRef = z.string().regex(/^TON-[A-Z0-9]{4}$/)

/* ------------------------------------------------------------------ */
/* Énumérations — source de vérité unique, client et serveur           */
/* ------------------------------------------------------------------ */

export const paymentChannel = z.enum(['wave', 'orange', 'mtn', 'moov', 'cash'])
export const collectionProvider = z.enum(['wave', 'orange', 'mtn', 'moov'])
export const frequency = z.enum(['daily', 'weekly', 'biweekly', 'monthly'])
export const tontineAccess = z.enum(['private', 'open'])
export const rotationMode = z.enum(['draw', 'fixed'])
export const feesBearer = z.enum(['member', 'tontine'])
export const membershipRole = z.enum(['president', 'treasurer', 'auditor', 'member'])

export const tontineStatus = z.enum(['draft', 'open', 'running', 'closed', 'archived'])
export const membershipStatus = z.enum([
  'invited', 'pending_approval', 'active', 'left', 'defaulted',
])
export const roundStatus = z.enum(['pending', 'collecting', 'payout_pending', 'closed'])
export const contributionStatus = z.enum(['due', 'late', 'declared', 'confirmed', 'disputed'])
export const payoutStatus = z.enum([
  'prepared', 'counter_validated', 'declared', 'acknowledged', 'disputed',
])

/**
 * Abonnement. Les valeurs viennent de `shared/constants/abonnement.ts` : la
 * grille est affichée par une page publique pré-rendue, qui ne doit pas
 * importer Zod pour trois prix.
 */
export const planTier = z.enum(PLAN_TIERS)
export const paidTier = z.enum(PAID_TIERS)
export const planPeriodicity = z.enum(PLAN_PERIODICITIES)
export const subscriptionRequestStatus = z.enum(['pending', 'approved', 'rejected'])

/* ------------------------------------------------------------------ */
/* Transitions autorisées — le serveur valide contre ces tables        */
/* Toute transition absente d'ici doit renvoyer INVALID_TRANSITION.    */
/* ------------------------------------------------------------------ */

export const CONTRIBUTION_TRANSITIONS = {
  due: ['declared', 'late'],
  late: ['declared'],
  declared: ['confirmed', 'disputed'],
  disputed: ['confirmed', 'due'],
  confirmed: [],
} as const satisfies Record<z.infer<typeof contributionStatus>, readonly string[]>

export const PAYOUT_TRANSITIONS = {
  prepared: ['counter_validated', 'declared'],
  counter_validated: ['declared'],
  declared: ['acknowledged', 'disputed'],
  disputed: ['declared'],
  acknowledged: [],
} as const satisfies Record<z.infer<typeof payoutStatus>, readonly string[]>

/**
 * Tontines — docs/data-model.md §2.1.
 * `draft → open` exige au moins un canal de collecte vérifié ;
 * `open → running` exige ≥ 3 membres actifs et un ordre de rotation figé.
 * Ces conditions ne sont pas dans la table : la table dit ce qui est *possible*,
 * le service dit ce qui est *permis maintenant*.
 */
export const TONTINE_TRANSITIONS = {
  draft: ['open'],
  open: ['running', 'archived'],
  running: ['closed'],
  closed: ['archived'],
  archived: [],
} as const satisfies Record<z.infer<typeof tontineStatus>, readonly string[]>

/**
 * Membres — docs/data-model.md §2.2.
 * `defaulted` est posé manuellement par le président, uniquement après un tour
 * où le membre a déjà pris la main. Il gèle les relances automatiques et
 * n'entraîne aucune publication publique.
 */
export const MEMBERSHIP_TRANSITIONS = {
  invited: ['pending_approval', 'left'],
  pending_approval: ['active', 'left'],
  active: ['left', 'defaulted'],
  left: [],
  defaulted: [],
} as const satisfies Record<z.infer<typeof membershipStatus>, readonly string[]>

/**
 * Demandes de passage à un palier payant.
 *
 * Une demande décidée est **définitive** : revenir sur une approbation se fait
 * par une nouvelle demande, jamais en rouvrant l'ancienne. Le back-office
 * garde ainsi une trace de qui a décidé quoi, et quand.
 */
export const SUBSCRIPTION_REQUEST_TRANSITIONS = {
  pending: ['approved', 'rejected'],
  approved: [],
  rejected: [],
} as const satisfies Record<z.infer<typeof subscriptionRequestStatus>, readonly string[]>

export const ROUND_TRANSITIONS = {
  pending: ['collecting'],
  collecting: ['payout_pending'],
  payout_pending: ['closed'],
  closed: [],
} as const satisfies Record<z.infer<typeof roundStatus>, readonly string[]>

/* ------------------------------------------------------------------ */
/* Authentification                                                    */
/* ------------------------------------------------------------------ */

export const otpRequestInput = z.object({ phone: phoneCI })
export const otpVerifyInput = z.object({ phone: phoneCI, code: otpCode })

export const profileInput = z.object({
  firstName: z.string().trim().min(2).max(50),
  lastName: z.string().trim().min(2).max(50),
  avatarUrl: z.string().url().optional(),
})

/* ------------------------------------------------------------------ */
/* Canaux de collecte                                                  */
/* ------------------------------------------------------------------ */

export const collectionChannelInput = z.object({
  provider: collectionProvider,
  msisdn: phoneCI,
  // Affiché au membre pour qu'il vérifie dans son app de paiement
  // qu'il envoie bien à la bonne personne. Protection anti-arnaque n°1.
  holderName: z.string().trim().min(3).max(80),
  paymentLinkUrl: z.string().url().optional(),
})

/* ------------------------------------------------------------------ */
/* Tontine                                                             */
/* ------------------------------------------------------------------ */

/**
 * Icône de tontine — **liste fermée**, pas de saisie libre.
 *
 * Un champ de texte libre accepterait n'importe quel caractère Unicode :
 * caractères de contrôle bidirectionnels, séquences de combinaison sans fin,
 * ou simplement une chaîne de trois cents octets qui casserait toutes les
 * listes. Une énumération de huit valeurs rend la question sans objet, et
 * l'écran de sélection devient une grille de boutons plutôt qu'un clavier.
 *
 * La liste elle-même vit dans `shared/constants/tontine.ts` : le wizard doit
 * pouvoir l'afficher sans importer Zod dans le lot client.
 */
export const tontineEmoji = z.enum(TONTINE_EMOJIS)

export const tontineDraftInput = z.object({
  name: z.string().trim().min(3).max(60),
  description: z.string().trim().max(500).optional(),
  avatarUrl: z.string().url().optional(),
  emoji: tontineEmoji.optional(),
  locality: z.string().trim().max(80).optional(),
  access: tontineAccess.default('private'),
})

export const tontineFinanceInput = z.object({
  shareAmount: amountFcfa,
  frequency,
  startDate: z.coerce.date().refine(d => d >= new Date(new Date().toDateString()), {
    message: 'La date de démarrage ne peut pas être dans le passé',
  }),
  collectionChannelIds: z.array(z.string().uuid()).min(1, 'Au moins un canal de collecte'),
  feesBearer,
})

export const tontineRulesInput = z.object({
  penaltyAmount: z.number().int().min(0).default(0),
  penaltyPeriod: z.enum(['once', 'per_day']).default('once'),
  penaltyCap: amountFcfa.optional(),
  graceDays: z.number().int().min(0).max(30).default(0),
})
  .refine(v => v.penaltyPeriod !== 'per_day' || v.penaltyCap !== undefined, {
    message: 'Une amende journalière doit avoir un plafond',
    path: ['penaltyCap'],
  })

export const rotationInput = z.object({
  mode: rotationMode,
  // Requis uniquement en mode 'fixed'. En mode 'draw', le tirage est fait
  // côté serveur et sa graine est écrite au registre — ne jamais tirer côté client.
  order: z.array(z.string().uuid()).optional(),
}).refine(v => v.mode !== 'fixed' || (v.order?.length ?? 0) > 0, {
  message: 'Un ordre fixe exige la liste des parts',
  path: ['order'],
})

/* ------------------------------------------------------------------ */
/* Membres                                                             */
/* ------------------------------------------------------------------ */

export const managedMemberInput = z.object({
  name: z.string().trim().min(3).max(80),
  phone: phoneCI,
  // Une part = une position dans la rotation. Un membre à double part
  // cotise deux fois par tour et prend la main deux fois.
  shares: z.number().int().min(1).max(5).default(1),
})

export const memberUpdateInput = z.object({
  role: membershipRole.optional(),
  shares: z.number().int().min(1).max(5).optional(),
  /**
   * `active` approuve une adhésion en attente, `left` la refuse ou fait sortir
   * un membre. Les autres états ne se posent pas à la main : `invited` et
   * `pending_approval` viennent du parcours d'invitation, et `defaulted`
   * demande une règle que le président ne pose pas d'un clic.
   */
  status: z.enum(['active', 'left']).optional(),
})

/* ------------------------------------------------------------------ */
/* Cotisation                                                          */
/* ------------------------------------------------------------------ */

export const declareContributionInput = z.object({
  amount: amountFcfa, // paiements partiels autorisés
  channel: paymentChannel,
  providerRef: z.string().trim().max(64).optional(),
  proofUrl: z.string().url().optional(),
  declaredAt: z.coerce.date().optional(), // défaut : horloge serveur
})

export const declareCashInput = declareContributionInput.extend({
  channel: z.literal('cash'),
  membershipId: z.string().uuid(),
})

export const rejectDeclarationInput = z.object({
  // Motif obligatoire : aucun rejet silencieux.
  reason: z.string().trim().min(5, 'Explique brièvement pourquoi').max(300),
})

export const bulkConfirmInput = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
})

/* ------------------------------------------------------------------ */
/* Versement                                                           */
/* ------------------------------------------------------------------ */

export const preparePayoutInput = z.object({
  // Le trésorier ressaisit les 4 derniers chiffres du numéro du bénéficiaire.
  // Garde-fou anti-erreur et anti-SIM-swap.
  beneficiaryPhoneLast4: z.string().regex(/^\d{4}$/),
  acceptIncompletePot: z.boolean().default(false),
})

export const declarePayoutInput = z.object({
  channel: paymentChannel,
  providerRef: z.string().trim().max(64).optional(),
  proofUrl: z.string().url().optional(),
})

export const acknowledgePayoutInput = z.object({
  // Le bénéficiaire ressaisit le montant reçu : confirmation active,
  // pas un simple bouton « OK ».
  receivedAmount: amountFcfa,
})

/* ------------------------------------------------------------------ */
/* Amendes, avances, litiges                                           */
/* ------------------------------------------------------------------ */

export const penaltyInput = z.object({ amount: amountFcfa, reason: z.string().max(300).optional() })
export const waivePenaltyInput = z.object({ reason: z.string().trim().min(5).max(300) })

export const advanceInput = z.object({
  roundId: z.string().uuid(),
  fromMembershipId: z.string().uuid(),
  toMembershipId: z.string().uuid(),
  amount: amountFcfa,
}).refine(v => v.fromMembershipId !== v.toMembershipId, {
  message: 'Un membre ne peut pas avancer pour lui-même',
})

export const disputeInput = z.object({
  message: z.string().trim().min(5).max(1000),
})

/* ------------------------------------------------------------------ */
/* Abonnement                                                          */
/* ------------------------------------------------------------------ */

/**
 * Demande de passage à un palier supérieur.
 *
 * Aucun montant n'est accepté du client : le prix est celui de la grille, lu
 * côté serveur à partir du palier et de la périodicité (règle 2). Un client qui
 * enverrait un prix le verrait ignoré, pas honoré.
 */
export const subscriptionRequestInput = z.object({
  tier: paidTier,
  periodicity: planPeriodicity,
})

/* ------------------------------------------------------------------ */
/* Erreur d'API — format unique                                        */
/* ------------------------------------------------------------------ */

export const apiErrorCode = z.enum([
  'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'VALIDATION_ERROR',
  'INVALID_TRANSITION', 'IDEMPOTENCY_CONFLICT', 'KYC_REQUIRED', 'RATE_LIMITED',
  'PLAN_LIMIT',
])

export const apiError = z.object({
  error: z.object({
    code: apiErrorCode,
    message: z.string(),
    field: z.string().optional(),
    requiredLevel: z.number().int().optional(), // pour KYC_REQUIRED
  }),
})

export type ApiError = z.infer<typeof apiError>
export type PaymentChannel = z.infer<typeof paymentChannel>
export type ContributionStatus = z.infer<typeof contributionStatus>
export type MembershipRole = z.infer<typeof membershipRole>
export type SubscriptionRequestStatus = z.infer<typeof subscriptionRequestStatus>

/**
 * Toutes les machines à états, indexées par nom. `assertTransition()` lit
 * cette table : ajouter une machine ici la rend immédiatement contrôlable
 * côté serveur.
 */
export const TRANSITIONS = {
  contribution: CONTRIBUTION_TRANSITIONS,
  payout: PAYOUT_TRANSITIONS,
  round: ROUND_TRANSITIONS,
  tontine: TONTINE_TRANSITIONS,
  membership: MEMBERSHIP_TRANSITIONS,
  subscriptionRequest: SUBSCRIPTION_REQUEST_TRANSITIONS,
} as const

export type StateMachine = keyof typeof TRANSITIONS
