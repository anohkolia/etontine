CREATE TABLE `admin_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`actor_phone` text NOT NULL,
	`action` text NOT NULL,
	`target_user_id` text,
	`payload` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `admin_audit_created_idx` ON `admin_audit` (`created_at`);--> statement-breakpoint
ALTER TABLE `users` ADD `kyc_reviewed_by` text;--> statement-breakpoint
ALTER TABLE `users` ADD `kyc_reviewed_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `kyc_rejection_reason` text;