import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { resolveSqliteFile } from './path.ts'
import * as schema from './schema.ts'

/**
 * Client de base de données. SQLite en développement, Postgres en production
 * (bascule prévue en T04) — c'est pourquoi rien n'importe `better-sqlite3`
 * ailleurs que dans ce fichier.
 */
let instance: ReturnType<typeof drizzle<typeof schema>> | undefined

export function useDb() {
  if (!instance) {
    const sqlite = new Database(resolveSqliteFile())
    // Concurrence en lecture pendant l'écriture, et intégrité référentielle :
    // les deux sont désactivées par défaut dans SQLite.
    sqlite.pragma('journal_mode = WAL')
    sqlite.pragma('foreign_keys = ON')

    instance = drizzle(sqlite, { schema })
  }
  return instance
}

export { schema }
