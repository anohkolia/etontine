ALTER TABLE `users` ADD `kyc_status` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `kyc_document_url` text;--> statement-breakpoint
ALTER TABLE `users` ADD `kyc_selfie_url` text;--> statement-breakpoint
ALTER TABLE `users` ADD `kyc_submitted_at` integer;