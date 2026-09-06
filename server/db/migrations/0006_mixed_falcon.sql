CREATE TABLE `subscription_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`tier` text NOT NULL,
	`periodicity` text NOT NULL,
	`price_fcfa` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`reviewed_by` text,
	`reviewed_at` integer,
	`review_note` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `subscription_requests_user_idx` ON `subscription_requests` (`user_id`);--> statement-breakpoint
CREATE INDEX `subscription_requests_status_idx` ON `subscription_requests` (`status`);--> statement-breakpoint
ALTER TABLE `users` ADD `plan_tier` text DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `plan_until` integer;