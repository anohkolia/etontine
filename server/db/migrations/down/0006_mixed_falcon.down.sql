-- Descente : abonnement (palier du président et demandes de passage).
DROP TABLE `subscription_requests`;
ALTER TABLE `users` DROP COLUMN `plan_until`;
ALTER TABLE `users` DROP COLUMN `plan_tier`;
