-- La validation des tontines confirmées avant la vérification d'identité.
-- Un président qui appuie sur « Confirmer » sans identité vérifiée laisse une
-- demande : le brouillon est validé d'office quand son identité est approuvée.
ALTER TABLE "tontines" ADD COLUMN "publish_requested_at" timestamp with time zone;--> statement-breakpoint
-- L'accès « ouvert » est retiré : on ne rejoint une tontine que par le lien de
-- son organisateur. Il n'avait aucun effet — aucune page ne listait les
-- tontines ouvertes —, les rares qui le portaient passent sur invitation.
UPDATE "tontines" SET "access" = 'private' WHERE "access" = 'open';
