CREATE TABLE "admin_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text NOT NULL,
	"actor_phone" text NOT NULL,
	"action" text NOT NULL,
	"target_user_id" text,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "advances" (
	"id" text PRIMARY KEY NOT NULL,
	"round_id" text NOT NULL,
	"from_membership_id" text NOT NULL,
	"to_membership_id" text NOT NULL,
	"amount" integer NOT NULL,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collection_channels" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"msisdn" text NOT NULL,
	"holder_name" text NOT NULL,
	"payment_link_url" text,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contributions" (
	"id" text PRIMARY KEY NOT NULL,
	"round_id" text NOT NULL,
	"share_id" text NOT NULL,
	"membership_id" text NOT NULL,
	"expected_amount" integer NOT NULL,
	"confirmed_amount" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'due' NOT NULL,
	"due_date" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contributions_round_share_unique" UNIQUE("round_id","share_id")
);
--> statement-breakpoint
CREATE TABLE "dispute_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"dispute_id" text NOT NULL,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" text PRIMARY KEY NOT NULL,
	"ledger_entry_id" text NOT NULL,
	"opened_by" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer NOT NULL,
	"response_body" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_key_user_endpoint_unique" UNIQUE("key","user_id","endpoint")
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"tontine_id" text NOT NULL,
	"created_by" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"max_uses" integer DEFAULT 1 NOT NULL,
	"used_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invites_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"tontine_id" text NOT NULL,
	"round_id" text,
	"type" text NOT NULL,
	"actor_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"reverses_id" text,
	"prev_hash" text,
	"hash" text NOT NULL,
	"position" integer NOT NULL,
	"server_timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_tontine_position_unique" UNIQUE("tontine_id","position")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"tontine_id" text NOT NULL,
	"user_id" text,
	"managed_name" text,
	"managed_phone" text,
	"role" text DEFAULT 'member' NOT NULL,
	"status" text DEFAULT 'invited' NOT NULL,
	"joined_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_tontine_user_unique" UNIQUE("tontine_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"tontine_id" text,
	"push_enabled" boolean DEFAULT true NOT NULL,
	"reminders_enabled" boolean DEFAULT true NOT NULL,
	"quiet_hours_start" integer,
	"quiet_hours_end" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notif_prefs_user_tontine_unique" UNIQUE("user_id","tontine_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"tontine_id" text,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"url" text,
	"read_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otp_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"code_hash" text NOT NULL,
	"channel" text DEFAULT 'sms' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_declarations" (
	"id" text PRIMARY KEY NOT NULL,
	"contribution_id" text NOT NULL,
	"declared_by" text NOT NULL,
	"source" text DEFAULT 'member' NOT NULL,
	"amount" integer NOT NULL,
	"channel" text NOT NULL,
	"provider_ref" text,
	"proof_url" text,
	"declared_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decision" text DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"rejection_reason" text,
	"escalated_at" timestamp with time zone,
	"member_acknowledged_at" timestamp with time zone,
	"unconfirmed_flagged_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" text PRIMARY KEY NOT NULL,
	"round_id" text NOT NULL,
	"beneficiary_membership_id" text NOT NULL,
	"amount" integer NOT NULL,
	"shortfall_amount" integer DEFAULT 0 NOT NULL,
	"channel" text,
	"provider_ref" text,
	"proof_url" text,
	"prepared_by" text,
	"counter_validated_by" text,
	"declared_by" text,
	"acknowledged_at" timestamp with time zone,
	"status" text DEFAULT 'prepared' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payouts_round_id_unique" UNIQUE("round_id")
);
--> statement-breakpoint
CREATE TABLE "penalties" (
	"id" text PRIMARY KEY NOT NULL,
	"contribution_id" text NOT NULL,
	"amount" integer NOT NULL,
	"status" text DEFAULT 'applied' NOT NULL,
	"reason" text,
	"applied_by" text NOT NULL,
	"waived_by" text,
	"waive_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "rounds" (
	"id" text PRIMARY KEY NOT NULL,
	"tontine_id" text NOT NULL,
	"index" integer NOT NULL,
	"due_date" text NOT NULL,
	"beneficiary_share_id" text NOT NULL,
	"expected_amount" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rounds_tontine_index_unique" UNIQUE("tontine_id","index")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shares" (
	"id" text PRIMARY KEY NOT NULL,
	"tontine_id" text NOT NULL,
	"membership_id" text NOT NULL,
	"rotation_position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shares_tontine_position_unique" UNIQUE("tontine_id","rotation_position")
);
--> statement-breakpoint
CREATE TABLE "subscription_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"tier" text NOT NULL,
	"periodicity" text NOT NULL,
	"price_fcfa" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tontine_channels" (
	"tontine_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"frozen_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tontine_channels_tontine_id_channel_id_pk" PRIMARY KEY("tontine_id","channel_id")
);
--> statement-breakpoint
CREATE TABLE "tontines" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"avatar_url" text,
	"emoji" text,
	"locality" text,
	"access" text DEFAULT 'private' NOT NULL,
	"share_amount" integer NOT NULL,
	"frequency" text NOT NULL,
	"start_date" text NOT NULL,
	"rotation_mode" text DEFAULT 'fixed' NOT NULL,
	"fees_bearer" text DEFAULT 'member' NOT NULL,
	"penalty_amount" integer DEFAULT 0 NOT NULL,
	"penalty_period" text DEFAULT 'once' NOT NULL,
	"penalty_cap" integer,
	"grace_days" integer DEFAULT 0 NOT NULL,
	"counter_validation_threshold" integer DEFAULT 100000 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" text NOT NULL,
	"rotation_frozen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"avatar_url" text,
	"kyc_level" integer DEFAULT 0 NOT NULL,
	"pin_hash" text,
	"phone_changed_at" timestamp with time zone,
	"kyc_status" text DEFAULT 'none' NOT NULL,
	"kyc_document_url" text,
	"kyc_selfie_url" text,
	"kyc_submitted_at" timestamp with time zone,
	"kyc_reviewed_by" text,
	"kyc_reviewed_at" timestamp with time zone,
	"kyc_rejection_reason" text,
	"plan_tier" text DEFAULT 'free' NOT NULL,
	"plan_until" timestamp with time zone,
	"consent_data_at" timestamp with time zone,
	"consent_notifications_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
ALTER TABLE "admin_audit" ADD CONSTRAINT "admin_audit_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_audit" ADD CONSTRAINT "admin_audit_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advances" ADD CONSTRAINT "advances_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advances" ADD CONSTRAINT "advances_from_membership_id_memberships_id_fk" FOREIGN KEY ("from_membership_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advances" ADD CONSTRAINT "advances_to_membership_id_memberships_id_fk" FOREIGN KEY ("to_membership_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_channels" ADD CONSTRAINT "collection_channels_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_share_id_shares_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."shares"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_messages" ADD CONSTRAINT "dispute_messages_dispute_id_disputes_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "public"."disputes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_messages" ADD CONSTRAINT "dispute_messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_ledger_entry_id_ledger_entries_id_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_opened_by_users_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_tontine_id_tontines_id_fk" FOREIGN KEY ("tontine_id") REFERENCES "public"."tontines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_tontine_id_tontines_id_fk" FOREIGN KEY ("tontine_id") REFERENCES "public"."tontines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tontine_id_tontines_id_fk" FOREIGN KEY ("tontine_id") REFERENCES "public"."tontines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_tontine_id_tontines_id_fk" FOREIGN KEY ("tontine_id") REFERENCES "public"."tontines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tontine_id_tontines_id_fk" FOREIGN KEY ("tontine_id") REFERENCES "public"."tontines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_declarations" ADD CONSTRAINT "payment_declarations_contribution_id_contributions_id_fk" FOREIGN KEY ("contribution_id") REFERENCES "public"."contributions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_declarations" ADD CONSTRAINT "payment_declarations_declared_by_users_id_fk" FOREIGN KEY ("declared_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_declarations" ADD CONSTRAINT "payment_declarations_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_beneficiary_membership_id_memberships_id_fk" FOREIGN KEY ("beneficiary_membership_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_prepared_by_users_id_fk" FOREIGN KEY ("prepared_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_counter_validated_by_users_id_fk" FOREIGN KEY ("counter_validated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_declared_by_users_id_fk" FOREIGN KEY ("declared_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "penalties" ADD CONSTRAINT "penalties_contribution_id_contributions_id_fk" FOREIGN KEY ("contribution_id") REFERENCES "public"."contributions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "penalties" ADD CONSTRAINT "penalties_applied_by_users_id_fk" FOREIGN KEY ("applied_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "penalties" ADD CONSTRAINT "penalties_waived_by_users_id_fk" FOREIGN KEY ("waived_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_tontine_id_tontines_id_fk" FOREIGN KEY ("tontine_id") REFERENCES "public"."tontines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_beneficiary_share_id_shares_id_fk" FOREIGN KEY ("beneficiary_share_id") REFERENCES "public"."shares"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shares" ADD CONSTRAINT "shares_tontine_id_tontines_id_fk" FOREIGN KEY ("tontine_id") REFERENCES "public"."tontines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shares" ADD CONSTRAINT "shares_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_requests" ADD CONSTRAINT "subscription_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_requests" ADD CONSTRAINT "subscription_requests_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tontine_channels" ADD CONSTRAINT "tontine_channels_tontine_id_tontines_id_fk" FOREIGN KEY ("tontine_id") REFERENCES "public"."tontines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tontine_channels" ADD CONSTRAINT "tontine_channels_channel_id_collection_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."collection_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tontines" ADD CONSTRAINT "tontines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_created_idx" ON "admin_audit" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "advances_round_idx" ON "advances" USING btree ("round_id");--> statement-breakpoint
CREATE INDEX "channels_user_idx" ON "collection_channels" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "contributions_membership_idx" ON "contributions" USING btree ("membership_id");--> statement-breakpoint
CREATE INDEX "contributions_status_idx" ON "contributions" USING btree ("status","due_date");--> statement-breakpoint
CREATE INDEX "dispute_messages_dispute_idx" ON "dispute_messages" USING btree ("dispute_id");--> statement-breakpoint
CREATE INDEX "disputes_entry_idx" ON "disputes" USING btree ("ledger_entry_id");--> statement-breakpoint
CREATE INDEX "ledger_tontine_idx" ON "ledger_entries" USING btree ("tontine_id","position");--> statement-breakpoint
CREATE INDEX "ledger_round_idx" ON "ledger_entries" USING btree ("round_id");--> statement-breakpoint
CREATE INDEX "memberships_tontine_idx" ON "memberships" USING btree ("tontine_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "otp_phone_idx" ON "otp_requests" USING btree ("phone","created_at");--> statement-breakpoint
CREATE INDEX "declarations_contribution_idx" ON "payment_declarations" USING btree ("contribution_id");--> statement-breakpoint
CREATE INDEX "declarations_decision_idx" ON "payment_declarations" USING btree ("decision","declared_at");--> statement-breakpoint
CREATE INDEX "penalties_contribution_idx" ON "penalties" USING btree ("contribution_id");--> statement-breakpoint
CREATE INDEX "push_user_idx" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "rounds_status_idx" ON "rounds" USING btree ("tontine_id","status");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "shares_membership_idx" ON "shares" USING btree ("membership_id");--> statement-breakpoint
CREATE INDEX "subscription_requests_user_idx" ON "subscription_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "subscription_requests_status_idx" ON "subscription_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tontines_status_idx" ON "tontines" USING btree ("status");