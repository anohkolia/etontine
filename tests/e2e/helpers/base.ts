import Database from 'better-sqlite3'
import { resolveSqliteFile } from '../../../server/db/path.ts'

/**
 * Accès direct à la base du serveur de développement, pour les **fixtures que
 * l'API ne peut pas produire** : un cycle terminé demande d'attendre chaque
 * échéance, et aucune route — à raison — ne clôt un tour sans son versement.
 *
 * Le même fichier que le serveur (`DATABASE_URL`), en écriture ponctuelle ;
 * `better-sqlite3` gère la concurrence avec le processus Nitro par le journal
 * WAL. À n'utiliser que pour poser un état, jamais pour vérifier un résultat :
 * ce qu'un test vérifie doit passer par l'écran ou par l'API.
 */
export function baseDeDeveloppement() {
  return new Database(resolveSqliteFile())
}

/** Marque une tontine terminée : tous ses tours clos, la tontine close. */
export function terminerTontine(tontineId: string): void {
  const db = baseDeDeveloppement()
  try {
    db.prepare('UPDATE rounds SET status = ? WHERE tontine_id = ?').run('closed', tontineId)
    db.prepare('UPDATE tontines SET status = ? WHERE id = ?').run('closed', tontineId)
  }
  finally {
    db.close()
  }
}
