-- Descente de la migration initiale.
--
-- `drizzle-kit` ne génère que la montée : cette descente est écrite à la main,
-- et `tests/unit/migrations.spec.ts` vérifie qu'un cycle montée → descente →
-- montée laisse le schéma identique. Sans ce test, une table ajoutée au schéma
-- sans être ajoutée ici rendrait la migration irréversible en silence.
--
-- L'ordre suit les dépendances : les tables qui référencent sont supprimées
-- avant celles qui sont référencées.
DROP TABLE IF EXISTS `dispute_messages`;--> statement-breakpoint
DROP TABLE IF EXISTS `disputes`;--> statement-breakpoint
DROP TABLE IF EXISTS `advances`;--> statement-breakpoint
DROP TABLE IF EXISTS `penalties`;--> statement-breakpoint
DROP TABLE IF EXISTS `ledger_entries`;--> statement-breakpoint
DROP TABLE IF EXISTS `payouts`;--> statement-breakpoint
DROP TABLE IF EXISTS `payment_declarations`;--> statement-breakpoint
DROP TABLE IF EXISTS `contributions`;--> statement-breakpoint
DROP TABLE IF EXISTS `rounds`;--> statement-breakpoint
DROP TABLE IF EXISTS `shares`;--> statement-breakpoint
DROP TABLE IF EXISTS `memberships`;--> statement-breakpoint
DROP TABLE IF EXISTS `tontine_channels`;--> statement-breakpoint
DROP TABLE IF EXISTS `invites`;--> statement-breakpoint
DROP TABLE IF EXISTS `push_subscriptions`;--> statement-breakpoint
DROP TABLE IF EXISTS `notification_preferences`;--> statement-breakpoint
DROP TABLE IF EXISTS `idempotency_keys`;--> statement-breakpoint
DROP TABLE IF EXISTS `collection_channels`;--> statement-breakpoint
DROP TABLE IF EXISTS `otp_requests`;--> statement-breakpoint
DROP TABLE IF EXISTS `sessions`;--> statement-breakpoint
DROP TABLE IF EXISTS `tontines`;--> statement-breakpoint
DROP TABLE IF EXISTS `users`;
