-- Descente de 0002_organisateurs : le back-office ne suit plus les
-- organisateurs. Qui a créé une tontine en reste président — ce rôle-là vit
-- dans `memberships`, il ne dépend pas de ces colonnes.
DROP INDEX IF EXISTS "users_organizer_idx";
--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "organizer_since";
--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "organizer_seen_at";
--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "organizer_seen_by";
