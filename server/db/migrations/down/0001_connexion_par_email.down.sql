-- Descente de 0001_connexion_par_email : on retrouve le schéma à codes SMS.
-- Les comptes perdent leur e-mail et leur verrouillage ; les liens envoyés
-- par e-mail sont perdus, un membre qui n'avait pas fini son inscription
-- devra la reprendre.
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
CREATE INDEX "otp_phone_idx" ON "otp_requests" USING btree ("phone","created_at");
--> statement-breakpoint
ALTER TABLE "collection_channels" ADD COLUMN "verified_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "memberships" DROP CONSTRAINT IF EXISTS "memberships_claimed_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "memberships" DROP COLUMN IF EXISTS "claimed_by_user_id";
--> statement-breakpoint
ALTER TABLE "memberships" DROP COLUMN IF EXISTS "claimed_at";
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_email_unique";
--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "email";
--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "email_verified_at";
--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "failed_logins";
--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "locked_until";
--> statement-breakpoint
DROP TABLE IF EXISTS "email_tokens" CASCADE;
