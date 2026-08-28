import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from '../../server/db/schema.ts'
import { MIGRATIONS_DIR } from '../../server/db/migrator.ts'

export type TestDb = ReturnType<typeof drizzle<typeof schema>>

/**
 * Base éphémère, migrée, pour un test. Sur disque plutôt qu'en mémoire : c'est
 * le même moteur, les mêmes contraintes de clés étrangères et les mêmes
 * comportements de transaction qu'en production.
 */
export function createTestDb(): { db: TestDb, sqlite: Database.Database, cleanup: () => void } {
  const dossier = mkdtempSync(join(tmpdir(), 'tontine-test-'))
  const sqlite = new Database(join(dossier, 'test.sqlite'))
  sqlite.pragma('foreign_keys = ON')

  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: MIGRATIONS_DIR })

  return {
    db,
    sqlite,
    cleanup: () => {
      sqlite.close()
      rmSync(dossier, { recursive: true, force: true })
    },
  }
}

/** Un utilisateur minimal, pour les tests qui ont juste besoin d'un acteur. */
export async function createTestUser(db: TestDb, id: string, phone: string) {
  await db.insert(schema.users).values({ id, phone })
  return id
}
