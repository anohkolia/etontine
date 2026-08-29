import { sql } from 'drizzle-orm'
import { index, integer, primaryKey, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'
import {
  collectionProvider,
  contributionStatus,
  feesBearer,
  frequency,
  membershipRole,
  membershipStatus,
  paymentChannel,
  payoutStatus,
  rotationMode,
  roundStatus,
  tontineAccess,
  tontineStatus,
} from '../../shared/schemas/index.ts'

/**
 * Schéma complet — voir docs/data-model.md §1.
 *
 * Trois conventions tenues partout :
 *
 * 1. **Les montants sont des entiers de FCFA** (`integer`). Jamais de `real`,
 *    jamais de centimes. Une colonne flottante ici et tout le registre devient
 *    faux à la troisième addition.
 * 2. **Les énumérations viennent de `shared/schemas`**, pas de littéraux
 *    recopiés : la base, le serveur et le client parlent des mêmes valeurs, et
 *    ajouter un statut au schéma Zod casse la compilation ici tant que la
 *    migration ne suit pas.
 * 3. **Les horodatages sont posés par le serveur** (`unixepoch()`), jamais par
 *    une valeur venue du client.
 */

const id = () => text('id').primaryKey()
const createdAt = () =>
  integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`)

/* ------------------------------------------------------------------ *
 * Personnes et accès
 * ------------------------------------------------------------------ */

export const users = sqliteTable('users', {
  id: id(),
  /** E.164 obligatoire, `+225XXXXXXXXXX` (règle 20). Normalisé avant insertion. */
  phone: text('phone').notNull().unique(),
  firstName: text('first_name'),
  lastName: text('last_name'),
  avatarUrl: text('avatar_url'),
  /** Palier KYC 0–3, voir docs/data-model.md §4. */
  kycLevel: integer('kyc_level').notNull().default(0),
  pinHash: text('pin_hash'),
  /** Déclenche le gel de 48 h sur les versements. */
  phoneChangedAt: integer('phone_changed_at', { mode: 'timestamp' }),
  /**
   * Vérification d'identité (palier 2). La revue manuelle relève du back-office,
   * hors périmètre MVP : `kycStatus` porte l'état pour que le jour où ce
   * back-office existe, rien ne soit à reprendre ici.
   */
  kycStatus: text('kyc_status', { enum: ['none', 'pending_review', 'approved', 'rejected'] })
    .notNull().default('none'),
  kycDocumentUrl: text('kyc_document_url'),
  kycSelfieUrl: text('kyc_selfie_url'),
  kycSubmittedAt: integer('kyc_submitted_at', { mode: 'timestamp' }),
  /** Qui a statué, quand, et pourquoi en cas de refus. */
  kycReviewedBy: text('kyc_reviewed_by'),
  kycReviewedAt: integer('kyc_reviewed_at', { mode: 'timestamp' }),
  kycRejectionReason: text('kyc_rejection_reason'),
  /** Consentements granulaires — deux cases distinctes (T08). */
  consentDataAt: integer('consent_data_at', { mode: 'timestamp' }),
  consentNotificationsAt: integer('consent_notifications_at', { mode: 'timestamp' }),
  createdAt: createdAt(),
})

/**
 * Sessions par cookie `httpOnly` (règle 19). Absente de docs/data-model.md,
 * mais le contrat d'API impose une session serveur : la stocker ici plutôt que
 * dans un JWT évite d'avoir à révoquer l'irrévocable.
 */
export const sessions = sqliteTable('sessions', {
  id: id(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  userAgent: text('user_agent'),
  createdAt: createdAt(),
}, t => [index('sessions_user_idx').on(t.userId)])

/**
 * Demandes d'OTP. Le code n'est jamais stocké en clair : seule son empreinte
 * l'est, comme un mot de passe.
 */
export const otpRequests = sqliteTable('otp_requests', {
  id: id(),
  phone: text('phone').notNull(),
  codeHash: text('code_hash').notNull(),
  channel: text('channel', { enum: ['sms', 'voice'] }).notNull().default('sms'),
  attempts: integer('attempts').notNull().default(0),
  consumedAt: integer('consumed_at', { mode: 'timestamp' }),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: createdAt(),
}, t => [index('otp_phone_idx').on(t.phone, t.createdAt)])

/* ------------------------------------------------------------------ *
 * Canaux de collecte
 * ------------------------------------------------------------------ */

export const collectionChannels = sqliteTable('collection_channels', {
  id: id(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider', { enum: collectionProvider.options }).notNull(),
  msisdn: text('msisdn').notNull(),
  /** Affiché au membre pour vérification anti-arnaque. Obligatoire (T09). */
  holderName: text('holder_name').notNull(),
  paymentLinkUrl: text('payment_link_url'),
  /** `null` = canal inutilisable. L'OTP sur le numéro de collecte est obligatoire. */
  verifiedAt: integer('verified_at', { mode: 'timestamp' }),
  createdAt: createdAt(),
}, t => [index('channels_user_idx').on(t.userId)])

/* ------------------------------------------------------------------ *
 * Tontines
 * ------------------------------------------------------------------ */

export const tontines = sqliteTable('tontines', {
  id: id(),
  name: text('name').notNull(),
  description: text('description'),
  avatarUrl: text('avatar_url'),
  locality: text('locality'),
  access: text('access', { enum: tontineAccess.options }).notNull().default('private'),
  /** Montant d'une part, en FCFA entiers. */
  shareAmount: integer('share_amount').notNull(),
  frequency: text('frequency', { enum: frequency.options }).notNull(),
  startDate: text('start_date').notNull(),
  rotationMode: text('rotation_mode', { enum: rotationMode.options }).notNull().default('fixed'),
  feesBearer: text('fees_bearer', { enum: feesBearer.options }).notNull().default('member'),
  /** 0 = pas d'amende. */
  penaltyAmount: integer('penalty_amount').notNull().default(0),
  penaltyPeriod: text('penalty_period', { enum: ['once', 'per_day'] }).notNull().default('once'),
  penaltyCap: integer('penalty_cap'),
  graceDays: integer('grace_days').notNull().default(0),
  /** Seuil de contre-validation d'un versement. Défaut 100 000 FCFA. */
  counterValidationThreshold: integer('counter_validation_threshold').notNull().default(100_000),
  status: text('status', { enum: tontineStatus.options }).notNull().default('draft'),
  createdBy: text('created_by').notNull().references(() => users.id),
  /** Figée au démarrage : après `start`, l'ordre ne change plus sans contre-validation. */
  rotationFrozenAt: integer('rotation_frozen_at', { mode: 'timestamp' }),
  createdAt: createdAt(),
}, t => [index('tontines_status_idx').on(t.status)])

export const tontineChannels = sqliteTable('tontine_channels', {
  tontineId: text('tontine_id').notNull().references(() => tontines.id, { onDelete: 'cascade' }),
  channelId: text('channel_id').notNull().references(() => collectionChannels.id, { onDelete: 'cascade' }),
  /** Gel de 48 h après un changement de canal (règle 22). */
  frozenUntil: integer('frozen_until', { mode: 'timestamp' }),
  createdAt: createdAt(),
}, t => [primaryKey({ columns: [t.tontineId, t.channelId] })])

/* ------------------------------------------------------------------ *
 * Membres et parts
 * ------------------------------------------------------------------ */

export const memberships = sqliteTable('memberships', {
  id: id(),
  tontineId: text('tontine_id').notNull().references(() => tontines.id, { onDelete: 'cascade' }),
  /** `null` pour un membre géré, qui n'a pas encore l'application. */
  userId: text('user_id').references(() => users.id),
  managedName: text('managed_name'),
  managedPhone: text('managed_phone'),
  /** Le rôle est **par tontine**, jamais global. */
  role: text('role', { enum: membershipRole.options }).notNull().default('member'),
  status: text('status', { enum: membershipStatus.options }).notNull().default('invited'),
  joinedAt: integer('joined_at', { mode: 'timestamp' }),
  createdAt: createdAt(),
}, t => [
  index('memberships_tontine_idx').on(t.tontineId),
  index('memberships_user_idx').on(t.userId),
  // Un même utilisateur n'adhère qu'une fois à une tontine donnée : sinon son
  // historique se dédouble au rattachement d'un membre géré (T12).
  unique('memberships_tontine_user_unique').on(t.tontineId, t.userId),
])

/**
 * Les parts. Une part = une position dans la rotation = un tour où l'on prend
 * la main. **Toute la logique de rotation raisonne sur cette table, jamais sur
 * `memberships`** : un membre à double part y possède deux lignes.
 *
 * `tontine_id` est dénormalisé — il se déduirait de `membership_id`, mais
 * SQLite ne sait pas poser une contrainte d'unicité à travers une jointure, et
 * l'unicité de `(tontine_id, rotation_position)` est exigée par le ticket T04.
 * C'est le prix d'une garantie tenue par la base plutôt que par du code.
 */
export const shares = sqliteTable('shares', {
  id: id(),
  tontineId: text('tontine_id').notNull().references(() => tontines.id, { onDelete: 'cascade' }),
  membershipId: text('membership_id').notNull().references(() => memberships.id, { onDelete: 'cascade' }),
  rotationPosition: integer('rotation_position').notNull(),
  createdAt: createdAt(),
}, t => [
  unique('shares_tontine_position_unique').on(t.tontineId, t.rotationPosition),
  index('shares_membership_idx').on(t.membershipId),
])

/* ------------------------------------------------------------------ *
 * Tours et cotisations
 * ------------------------------------------------------------------ */

export const rounds = sqliteTable('rounds', {
  id: id(),
  tontineId: text('tontine_id').notNull().references(() => tontines.id, { onDelete: 'cascade' }),
  index: integer('index').notNull(),
  dueDate: text('due_date').notNull(),
  /** La part qui prend la main, pas le membre : un double part a deux tours. */
  beneficiaryShareId: text('beneficiary_share_id').notNull().references(() => shares.id),
  /** `share_amount × nombre total de parts`, bénéficiaire inclus. */
  expectedAmount: integer('expected_amount').notNull(),
  status: text('status', { enum: roundStatus.options }).notNull().default('pending'),
  closedAt: integer('closed_at', { mode: 'timestamp' }),
  createdAt: createdAt(),
}, t => [
  unique('rounds_tontine_index_unique').on(t.tontineId, t.index),
  index('rounds_status_idx').on(t.tontineId, t.status),
])

/**
 * Une ligne par part et par tour. **Le bénéficiaire cotise aussi** : c'est
 * l'usage ivoirien, et l'exclure fausserait le pot.
 */
export const contributions = sqliteTable('contributions', {
  id: id(),
  roundId: text('round_id').notNull().references(() => rounds.id, { onDelete: 'cascade' }),
  shareId: text('share_id').notNull().references(() => shares.id, { onDelete: 'cascade' }),
  membershipId: text('membership_id').notNull().references(() => memberships.id, { onDelete: 'cascade' }),
  expectedAmount: integer('expected_amount').notNull(),
  /** Somme des déclarations confirmées. Les paiements partiels sont autorisés. */
  confirmedAmount: integer('confirmed_amount').notNull().default(0),
  status: text('status', { enum: contributionStatus.options }).notNull().default('due'),
  dueDate: text('due_date').notNull(),
  createdAt: createdAt(),
}, t => [
  unique('contributions_round_share_unique').on(t.roundId, t.shareId),
  index('contributions_membership_idx').on(t.membershipId),
  index('contributions_status_idx').on(t.status, t.dueDate),
])

export const paymentDeclarations = sqliteTable('payment_declarations', {
  id: id(),
  contributionId: text('contribution_id').notNull().references(() => contributions.id, { onDelete: 'cascade' }),
  declaredBy: text('declared_by').notNull().references(() => users.id),
  source: text('source', { enum: ['member', 'treasurer', 'system'] }).notNull().default('member'),
  amount: integer('amount').notNull(),
  channel: text('channel', { enum: paymentChannel.options }).notNull(),
  providerRef: text('provider_ref'),
  proofUrl: text('proof_url'),
  declaredAt: integer('declared_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  decision: text('decision', { enum: ['pending', 'confirmed', 'rejected'] }).notNull().default('pending'),
  /** **Doit différer de `declaredBy`** — vérifié côté serveur, pas côté client. */
  decidedBy: text('decided_by').references(() => users.id),
  decidedAt: integer('decided_at', { mode: 'timestamp' }),
  /** Obligatoire si `decision = 'rejected'`. */
  rejectionReason: text('rejection_reason'),
  /** Posé automatiquement à +48 h sans décision. */
  escalatedAt: integer('escalated_at', { mode: 'timestamp' }),
  /**
   * Confirmation **inverse** : quand le trésorier déclare des espèces pour un
   * tiers, c'est au membre de reconnaître le versement. Sans cette contrepartie,
   * le bureau pourrait porter au registre des versements qui n'ont jamais eu lieu.
   */
  memberAcknowledgedAt: integer('member_acknowledged_at', { mode: 'timestamp' }),
  /** Posé à +72 h quand le membre n'a toujours pas reconnu un versement en espèces. */
  unconfirmedFlaggedAt: integer('unconfirmed_flagged_at', { mode: 'timestamp' }),
}, t => [
  index('declarations_contribution_idx').on(t.contributionId),
  index('declarations_decision_idx').on(t.decision, t.declaredAt),
])

/* ------------------------------------------------------------------ *
 * Versement du pot
 * ------------------------------------------------------------------ */

export const payouts = sqliteTable('payouts', {
  id: id(),
  roundId: text('round_id').notNull().unique().references(() => rounds.id, { onDelete: 'cascade' }),
  beneficiaryMembershipId: text('beneficiary_membership_id').notNull().references(() => memberships.id),
  amount: integer('amount').notNull(),
  /** Manquant assumé si le président force un versement sur pot incomplet. */
  shortfallAmount: integer('shortfall_amount').notNull().default(0),
  channel: text('channel', { enum: paymentChannel.options }),
  providerRef: text('provider_ref'),
  proofUrl: text('proof_url'),
  preparedBy: text('prepared_by').references(() => users.id),
  /** Doit différer de `preparedBy` (docs/data-model.md §2.5). */
  counterValidatedBy: text('counter_validated_by').references(() => users.id),
  declaredBy: text('declared_by').references(() => users.id),
  /** Seul le bénéficiaire peut poser cet horodatage. */
  acknowledgedAt: integer('acknowledged_at', { mode: 'timestamp' }),
  status: text('status', { enum: payoutStatus.options }).notNull().default('prepared'),
  createdAt: createdAt(),
})

/* ------------------------------------------------------------------ *
 * Registre — append-only
 * ------------------------------------------------------------------ */

/**
 * Types d'écriture du registre.
 *
 * La liste de docs/data-model.md §1 est reprise telle quelle, **plus deux
 * types** que l'acceptation de T17 rend nécessaires : une déclaration escaladée
 * et un versement en espèces non reconnu doivent être « visibles de tous au
 * registre », et aucun type existant ne dit cela sans mentir sur la nature du
 * fait. Extension signalée, à reporter dans la spécification.
 */
export const LEDGER_TYPES = [
  'contribution_declared', 'contribution_confirmed', 'contribution_rejected',
  'penalty_applied', 'penalty_waived',
  'payout_declared', 'payout_acknowledged',
  'member_joined', 'member_left',
  'rotation_changed', 'settings_changed', 'reversal',
  'declaration_escalated', 'cash_unconfirmed',
] as const

/**
 * Registre chaîné par tontine. **Aucune route `PUT` ni `DELETE` ne doit
 * exister sur cette table** (règle 3) : une écriture erronée se corrige par une
 * écriture `reversal` qui référence l'originale.
 *
 * `hash = sha256(prev_hash + type + actor_id + canonical_json(payload) + server_timestamp)`.
 */
export const ledgerEntries = sqliteTable('ledger_entries', {
  id: id(),
  tontineId: text('tontine_id').notNull().references(() => tontines.id, { onDelete: 'cascade' }),
  roundId: text('round_id').references(() => rounds.id),
  type: text('type', { enum: LEDGER_TYPES }).notNull(),
  actorId: text('actor_id').notNull().references(() => users.id),
  /** Données figées au moment de l'écriture, en JSON canonique. */
  payload: text('payload', { mode: 'json' }).notNull(),
  /** L'écriture annulée, si `type = 'reversal'`. */
  reversesId: text('reverses_id'),
  prevHash: text('prev_hash'),
  hash: text('hash').notNull(),
  /** Position dans la chaîne de la tontine, 1..n. Sert au diagnostic de rupture. */
  position: integer('position').notNull(),
  /** Horloge **serveur**, jamais celle du client. */
  serverTimestamp: integer('server_timestamp', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, t => [
  unique('ledger_tontine_position_unique').on(t.tontineId, t.position),
  index('ledger_tontine_idx').on(t.tontineId, t.position),
  index('ledger_round_idx').on(t.roundId),
])

/* ------------------------------------------------------------------ *
 * Amendes, avances, litiges
 * ------------------------------------------------------------------ */

export const penalties = sqliteTable('penalties', {
  id: id(),
  contributionId: text('contribution_id').notNull().references(() => contributions.id, { onDelete: 'cascade' }),
  amount: integer('amount').notNull(),
  status: text('status', { enum: ['applied', 'waived'] }).notNull().default('applied'),
  reason: text('reason'),
  /** Jamais automatique : une amende exige la validation explicite du président. */
  appliedBy: text('applied_by').notNull().references(() => users.id),
  waivedBy: text('waived_by').references(() => users.id),
  /** Obligatoire pour annuler. */
  waiveReason: text('waive_reason'),
  createdAt: createdAt(),
}, t => [index('penalties_contribution_idx').on(t.contributionId)])

/** Un membre avance pour un autre. Cas fréquent, à ne pas oublier. */
export const advances = sqliteTable('advances', {
  id: id(),
  roundId: text('round_id').notNull().references(() => rounds.id, { onDelete: 'cascade' }),
  fromMembershipId: text('from_membership_id').notNull().references(() => memberships.id),
  toMembershipId: text('to_membership_id').notNull().references(() => memberships.id),
  amount: integer('amount').notNull(),
  settledAt: integer('settled_at', { mode: 'timestamp' }),
  createdAt: createdAt(),
}, t => [index('advances_round_idx').on(t.roundId)])

export const disputes = sqliteTable('disputes', {
  id: id(),
  ledgerEntryId: text('ledger_entry_id').notNull().references(() => ledgerEntries.id),
  openedBy: text('opened_by').notNull().references(() => users.id),
  status: text('status', { enum: ['open', 'resolved'] }).notNull().default('open'),
  resolvedBy: text('resolved_by').references(() => users.id),
  resolvedAt: integer('resolved_at', { mode: 'timestamp' }),
  resolution: text('resolution'),
  createdAt: createdAt(),
}, t => [index('disputes_entry_idx').on(t.ledgerEntryId)])

export const disputeMessages = sqliteTable('dispute_messages', {
  id: id(),
  disputeId: text('dispute_id').notNull().references(() => disputes.id, { onDelete: 'cascade' }),
  authorId: text('author_id').notNull().references(() => users.id),
  body: text('body').notNull(),
  createdAt: createdAt(),
}, t => [index('dispute_messages_dispute_idx').on(t.disputeId)])

/* ------------------------------------------------------------------ *
 * Invitations et notifications
 * ------------------------------------------------------------------ */

export const invites = sqliteTable('invites', {
  id: id(),
  token: text('token').notNull().unique(),
  tontineId: text('tontine_id').notNull().references(() => tontines.id, { onDelete: 'cascade' }),
  createdBy: text('created_by').notNull().references(() => users.id),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  maxUses: integer('max_uses').notNull().default(1),
  usedCount: integer('used_count').notNull().default(0),
  createdAt: createdAt(),
})

export const notificationPreferences = sqliteTable('notification_preferences', {
  id: id(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** `null` = préférences par défaut, toutes tontines confondues. */
  tontineId: text('tontine_id').references(() => tontines.id, { onDelete: 'cascade' }),
  pushEnabled: integer('push_enabled', { mode: 'boolean' }).notNull().default(true),
  remindersEnabled: integer('reminders_enabled', { mode: 'boolean' }).notNull().default(true),
  /** Plage de silence, en minutes depuis minuit. */
  quietHoursStart: integer('quiet_hours_start'),
  quietHoursEnd: integer('quiet_hours_end'),
  createdAt: createdAt(),
}, t => [unique('notif_prefs_user_tontine_unique').on(t.userId, t.tontineId)])

/**
 * Notifications en attente de lecture.
 *
 * **Aucune notification ne contient de montant** (règle 21) : elle s'affiche
 * sur un écran verrouillé, et les téléphones se partagent. « Nouvelle activité
 * sur ta tontine », jamais « Tu as reçu 250 000 FCFA ». Un test le vérifie sur
 * l'ensemble des notifications produites.
 */
export const notifications = sqliteTable('notifications', {
  id: id(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tontineId: text('tontine_id').references(() => tontines.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  /** Lien d'ouverture dans l'application. */
  url: text('url'),
  readAt: integer('read_at', { mode: 'timestamp' }),
  /** Posé quand l'envoi push a réellement eu lieu (T23). */
  sentAt: integer('sent_at', { mode: 'timestamp' }),
  createdAt: createdAt(),
}, t => [index('notifications_user_idx').on(t.userId, t.createdAt)])

export const pushSubscriptions = sqliteTable('push_subscriptions', {
  id: id(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  createdAt: createdAt(),
}, t => [index('push_user_idx').on(t.userId)])

/* ------------------------------------------------------------------ *
 * Idempotence
 * ------------------------------------------------------------------ */

/**
 * Rejeu d'une `Idempotency-Key` : on renvoie la réponse d'origine sans rien
 * recréer (règle 4). La clé est portée par l'utilisateur **et** la route, pour
 * qu'une clé réutilisée sur un autre point d'entrée ne renvoie pas la réponse
 * d'un autre appel.
 */
export const idempotencyKeys = sqliteTable('idempotency_keys', {
  id: id(),
  key: text('key').notNull(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  endpoint: text('endpoint').notNull(),
  /** Empreinte du corps de requête : même clé + corps différent = conflit. */
  requestHash: text('request_hash').notNull(),
  responseStatus: integer('response_status').notNull(),
  responseBody: text('response_body', { mode: 'json' }).notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: createdAt(),
}, t => [unique('idempotency_key_user_endpoint_unique').on(t.key, t.userId, t.endpoint)])

/* ------------------------------------------------------------------ *
 * Types inférés
 * ------------------------------------------------------------------ */

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Tontine = typeof tontines.$inferSelect
export type Membership = typeof memberships.$inferSelect
export type Share = typeof shares.$inferSelect
export type Round = typeof rounds.$inferSelect
export type Contribution = typeof contributions.$inferSelect
export type PaymentDeclaration = typeof paymentDeclarations.$inferSelect
export type Payout = typeof payouts.$inferSelect
export type LedgerEntry = typeof ledgerEntries.$inferSelect
export type LedgerType = (typeof LEDGER_TYPES)[number]

/* ------------------------------------------------------------------ *
 * Journal d'administration
 * ------------------------------------------------------------------ */

/**
 * Trace de toute action d'administration.
 *
 * Le registre (`ledger_entries`) est chaîné **par tontine** : une décision de
 * vérification d'identité ne s'y range pas, elle ne concerne aucune tontine en
 * particulier. Elle a pourtant besoin d'une trace, et pour la même raison —
 * approuver une pièce d'identité, c'est autoriser quelqu'un à collecter
 * l'argent d'un groupe. Sans journal, cette décision n'aurait aucun auteur.
 *
 * Append-only, comme le registre : ni mise à jour ni suppression.
 */
export const adminAudit = sqliteTable('admin_audit', {
  id: id(),
  /** L'administrateur qui a agi. Jamais déduit du payload. */
  actorId: text('actor_id').notNull().references(() => users.id),
  actorPhone: text('actor_phone').notNull(),
  action: text('action').notNull(),
  /** La personne concernée, quand il y en a une. */
  targetUserId: text('target_user_id').references(() => users.id),
  payload: text('payload', { mode: 'json' }).notNull(),
  /** Horloge serveur, jamais celle du client. */
  createdAt: createdAt(),
}, t => [index('admin_audit_created_idx').on(t.createdAt)])

export type AdminAudit = typeof adminAudit.$inferSelect
