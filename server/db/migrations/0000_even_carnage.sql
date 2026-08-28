CREATE TABLE `advances` (
	`id` text PRIMARY KEY NOT NULL,
	`round_id` text NOT NULL,
	`from_membership_id` text NOT NULL,
	`to_membership_id` text NOT NULL,
	`amount` integer NOT NULL,
	`settled_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`from_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `advances_round_idx` ON `advances` (`round_id`);--> statement-breakpoint
CREATE TABLE `collection_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`msisdn` text NOT NULL,
	`holder_name` text NOT NULL,
	`payment_link_url` text,
	`verified_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `channels_user_idx` ON `collection_channels` (`user_id`);--> statement-breakpoint
CREATE TABLE `contributions` (
	`id` text PRIMARY KEY NOT NULL,
	`round_id` text NOT NULL,
	`share_id` text NOT NULL,
	`membership_id` text NOT NULL,
	`expected_amount` integer NOT NULL,
	`confirmed_amount` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'due' NOT NULL,
	`due_date` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`share_id`) REFERENCES `shares`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `contributions_membership_idx` ON `contributions` (`membership_id`);--> statement-breakpoint
CREATE INDEX `contributions_status_idx` ON `contributions` (`status`,`due_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `contributions_round_share_unique` ON `contributions` (`round_id`,`share_id`);--> statement-breakpoint
CREATE TABLE `dispute_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`dispute_id` text NOT NULL,
	`author_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`dispute_id`) REFERENCES `disputes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `dispute_messages_dispute_idx` ON `dispute_messages` (`dispute_id`);--> statement-breakpoint
CREATE TABLE `disputes` (
	`id` text PRIMARY KEY NOT NULL,
	`ledger_entry_id` text NOT NULL,
	`opened_by` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`resolved_by` text,
	`resolved_at` integer,
	`resolution` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`ledger_entry_id`) REFERENCES `ledger_entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`opened_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resolved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `disputes_entry_idx` ON `disputes` (`ledger_entry_id`);--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`user_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`request_hash` text NOT NULL,
	`response_status` integer NOT NULL,
	`response_body` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idempotency_key_user_endpoint_unique` ON `idempotency_keys` (`key`,`user_id`,`endpoint`);--> statement-breakpoint
CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`tontine_id` text NOT NULL,
	`created_by` text NOT NULL,
	`expires_at` integer NOT NULL,
	`max_uses` integer DEFAULT 1 NOT NULL,
	`used_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`tontine_id`) REFERENCES `tontines`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invites_token_unique` ON `invites` (`token`);--> statement-breakpoint
CREATE TABLE `ledger_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`tontine_id` text NOT NULL,
	`round_id` text,
	`type` text NOT NULL,
	`actor_id` text NOT NULL,
	`payload` text NOT NULL,
	`reverses_id` text,
	`prev_hash` text,
	`hash` text NOT NULL,
	`position` integer NOT NULL,
	`server_timestamp` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`tontine_id`) REFERENCES `tontines`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ledger_tontine_idx` ON `ledger_entries` (`tontine_id`,`position`);--> statement-breakpoint
CREATE INDEX `ledger_round_idx` ON `ledger_entries` (`round_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_tontine_position_unique` ON `ledger_entries` (`tontine_id`,`position`);--> statement-breakpoint
CREATE TABLE `memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`tontine_id` text NOT NULL,
	`user_id` text,
	`managed_name` text,
	`managed_phone` text,
	`role` text DEFAULT 'member' NOT NULL,
	`status` text DEFAULT 'invited' NOT NULL,
	`joined_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`tontine_id`) REFERENCES `tontines`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `memberships_tontine_idx` ON `memberships` (`tontine_id`);--> statement-breakpoint
CREATE INDEX `memberships_user_idx` ON `memberships` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `memberships_tontine_user_unique` ON `memberships` (`tontine_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `notification_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`tontine_id` text,
	`push_enabled` integer DEFAULT true NOT NULL,
	`reminders_enabled` integer DEFAULT true NOT NULL,
	`quiet_hours_start` integer,
	`quiet_hours_end` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tontine_id`) REFERENCES `tontines`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notif_prefs_user_tontine_unique` ON `notification_preferences` (`user_id`,`tontine_id`);--> statement-breakpoint
CREATE TABLE `otp_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`phone` text NOT NULL,
	`code_hash` text NOT NULL,
	`channel` text DEFAULT 'sms' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`consumed_at` integer,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `otp_phone_idx` ON `otp_requests` (`phone`,`created_at`);--> statement-breakpoint
CREATE TABLE `payment_declarations` (
	`id` text PRIMARY KEY NOT NULL,
	`contribution_id` text NOT NULL,
	`declared_by` text NOT NULL,
	`source` text DEFAULT 'member' NOT NULL,
	`amount` integer NOT NULL,
	`channel` text NOT NULL,
	`provider_ref` text,
	`proof_url` text,
	`declared_at` integer DEFAULT (unixepoch()) NOT NULL,
	`decision` text DEFAULT 'pending' NOT NULL,
	`decided_by` text,
	`decided_at` integer,
	`rejection_reason` text,
	`escalated_at` integer,
	FOREIGN KEY (`contribution_id`) REFERENCES `contributions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`declared_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `declarations_contribution_idx` ON `payment_declarations` (`contribution_id`);--> statement-breakpoint
CREATE INDEX `declarations_decision_idx` ON `payment_declarations` (`decision`,`declared_at`);--> statement-breakpoint
CREATE TABLE `payouts` (
	`id` text PRIMARY KEY NOT NULL,
	`round_id` text NOT NULL,
	`beneficiary_membership_id` text NOT NULL,
	`amount` integer NOT NULL,
	`shortfall_amount` integer DEFAULT 0 NOT NULL,
	`channel` text,
	`provider_ref` text,
	`proof_url` text,
	`prepared_by` text,
	`counter_validated_by` text,
	`declared_by` text,
	`acknowledged_at` integer,
	`status` text DEFAULT 'prepared' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`beneficiary_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`prepared_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`counter_validated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`declared_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payouts_round_id_unique` ON `payouts` (`round_id`);--> statement-breakpoint
CREATE TABLE `penalties` (
	`id` text PRIMARY KEY NOT NULL,
	`contribution_id` text NOT NULL,
	`amount` integer NOT NULL,
	`status` text DEFAULT 'applied' NOT NULL,
	`reason` text,
	`applied_by` text NOT NULL,
	`waived_by` text,
	`waive_reason` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`contribution_id`) REFERENCES `contributions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`applied_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`waived_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `penalties_contribution_idx` ON `penalties` (`contribution_id`);--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_endpoint_unique` ON `push_subscriptions` (`endpoint`);--> statement-breakpoint
CREATE INDEX `push_user_idx` ON `push_subscriptions` (`user_id`);--> statement-breakpoint
CREATE TABLE `rounds` (
	`id` text PRIMARY KEY NOT NULL,
	`tontine_id` text NOT NULL,
	`index` integer NOT NULL,
	`due_date` text NOT NULL,
	`beneficiary_share_id` text NOT NULL,
	`expected_amount` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`closed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`tontine_id`) REFERENCES `tontines`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`beneficiary_share_id`) REFERENCES `shares`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `rounds_status_idx` ON `rounds` (`tontine_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `rounds_tontine_index_unique` ON `rounds` (`tontine_id`,`index`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`user_agent` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `shares` (
	`id` text PRIMARY KEY NOT NULL,
	`tontine_id` text NOT NULL,
	`membership_id` text NOT NULL,
	`rotation_position` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`tontine_id`) REFERENCES `tontines`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `shares_membership_idx` ON `shares` (`membership_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `shares_tontine_position_unique` ON `shares` (`tontine_id`,`rotation_position`);--> statement-breakpoint
CREATE TABLE `tontine_channels` (
	`tontine_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`frozen_until` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`tontine_id`, `channel_id`),
	FOREIGN KEY (`tontine_id`) REFERENCES `tontines`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channel_id`) REFERENCES `collection_channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tontines` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`avatar_url` text,
	`locality` text,
	`access` text DEFAULT 'private' NOT NULL,
	`share_amount` integer NOT NULL,
	`frequency` text NOT NULL,
	`start_date` text NOT NULL,
	`rotation_mode` text DEFAULT 'fixed' NOT NULL,
	`fees_bearer` text DEFAULT 'member' NOT NULL,
	`penalty_amount` integer DEFAULT 0 NOT NULL,
	`penalty_period` text DEFAULT 'once' NOT NULL,
	`penalty_cap` integer,
	`grace_days` integer DEFAULT 0 NOT NULL,
	`counter_validation_threshold` integer DEFAULT 100000 NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_by` text NOT NULL,
	`rotation_frozen_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `tontines_status_idx` ON `tontines` (`status`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`phone` text NOT NULL,
	`first_name` text,
	`last_name` text,
	`avatar_url` text,
	`kyc_level` integer DEFAULT 0 NOT NULL,
	`pin_hash` text,
	`phone_changed_at` integer,
	`consent_data_at` integer,
	`consent_notifications_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_phone_unique` ON `users` (`phone`);