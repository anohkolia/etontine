-- Descente : confirmation inverse des versements en espèces (T17).
ALTER TABLE `payment_declarations` DROP COLUMN `unconfirmed_flagged_at`;--> statement-breakpoint
ALTER TABLE `payment_declarations` DROP COLUMN `member_acknowledged_at`;
