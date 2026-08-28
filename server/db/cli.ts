/**
 * Petit utilitaire en ligne de commande pour ce que `drizzle-kit` ne fait pas.
 * Exécuté par `pnpm db:rollback`. Node 24 lit le TypeScript sans transpilation.
 */
import Database from 'better-sqlite3'
import { resolveSqliteFile } from './path.ts'
import { rollbackLast } from './migrator.ts'

const commande = process.argv[2]

if (commande !== 'rollback') {
  console.error('Usage : node server/db/cli.ts rollback')
  process.exit(1)
}

const sqlite = new Database(resolveSqliteFile())
sqlite.pragma('foreign_keys = OFF') // on démonte, l'ordre est déjà géré

const nom = rollbackLast(sqlite)
console.log(nom ? `Migration annulée : ${nom}` : 'Aucune migration à annuler.')
sqlite.close()
