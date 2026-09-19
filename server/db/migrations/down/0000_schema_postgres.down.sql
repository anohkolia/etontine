-- Descente de 0000_schema_postgres : le schéma entier disparaît.
-- CASCADE lève les contraintes de clés étrangères entre tables ; l'ordre
-- inverse de la montée reste respecté par lisibilité.
DROP TABLE IF EXISTS "users" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "tontines" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "tontine_channels" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "subscription_requests" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "shares" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "sessions" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "rounds" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "push_subscriptions" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "penalties" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "payouts" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "payment_declarations" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "otp_requests" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "notifications" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "notification_preferences" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "memberships" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "ledger_entries" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "invites" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "idempotency_keys" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "disputes" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "dispute_messages" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "contributions" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "collection_channels" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "advances" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "admin_audit" CASCADE;
