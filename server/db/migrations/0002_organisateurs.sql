-- Les organisateurs, suivis par le back-office.
-- Un compte qui s'inscrit sans lien d'invitation vient organiser une tontine :
-- il est marqué dès l'inscription, et le back-office est alerté à la
-- confirmation de son adresse. Un compte venu d'une invitation ne l'est qu'à
-- sa première tontine.
ALTER TABLE "users" ADD COLUMN "organizer_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "organizer_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "organizer_seen_by" text;--> statement-breakpoint
CREATE INDEX "users_organizer_idx" ON "users" USING btree ("organizer_since");--> statement-breakpoint
-- Reprise de l'existant : qui a déjà créé une tontine organise depuis sa
-- première. Ces comptes précèdent l'alerte, ils sont donc réputés connus —
-- sans cela, le back-office ouvrirait sur une alerte par organisateur existant.
UPDATE "users" SET
	"organizer_since" = "premieres"."premiere",
	"organizer_seen_at" = now()
FROM (
	SELECT "created_by", min("created_at") AS "premiere" FROM "tontines" GROUP BY "created_by"
) AS "premieres"
WHERE "premieres"."created_by" = "users"."id";
