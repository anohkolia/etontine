import { eq } from 'drizzle-orm'
import { useDb } from '../../../server/db/index.ts'
import { rounds, tontines } from '../../../server/db/schema.ts'

/**
 * Accès direct à la base du serveur de développement, pour les **fixtures que
 * l'API ne peut pas produire** : un cycle terminé demande d'attendre chaque
 * échéance, et aucune route — à raison — ne clôt un tour sans son versement.
 *
 * La même base que les deux serveurs (`DATABASE_URL`, le PGlite local par
 * défaut), par le même client Drizzle. À n'utiliser que pour poser un état,
 * jamais pour vérifier un résultat : ce qu'un test vérifie doit passer par
 * l'écran ou par l'API.
 */

/** Marque une tontine terminée : tous ses tours clos, la tontine close. */
export async function terminerTontine(tontineId: string): Promise<void> {
  const db = useDb()
  await db.update(rounds).set({ status: 'closed' }).where(eq(rounds.tontineId, tontineId))
  await db.update(tontines).set({ status: 'closed' }).where(eq(tontines.id, tontineId))
}
