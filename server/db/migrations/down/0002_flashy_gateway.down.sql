-- Descente : colonnes de vérification d'identité (T08 / T10).
--
-- SQLite sait retirer une colonne depuis la version 3.35 ; `better-sqlite3`
-- embarque une version bien plus récente. Une par instruction, car
-- `DROP COLUMN` n'accepte pas de liste.
ALTER TABLE `users` DROP COLUMN `kyc_submitted_at`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `kyc_selfie_url`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `kyc_document_url`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `kyc_status`;
