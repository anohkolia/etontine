-- Descente : journal d'administration et suivi des décisions KYC.
DROP TABLE IF EXISTS `admin_audit`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `kyc_rejection_reason`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `kyc_reviewed_at`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `kyc_reviewed_by`;
