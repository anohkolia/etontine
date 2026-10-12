-- Descente de 0003_validation_tontines : les demandes de validation en
-- attente sont oubliées — le président reconfirmera ses brouillons. L'accès
-- « ouvert » n'est pas rétabli : il n'avait aucun effet, et l'on ne sait plus
-- quelles tontines le portaient.
ALTER TABLE "tontines" DROP COLUMN IF EXISTS "publish_requested_at";
