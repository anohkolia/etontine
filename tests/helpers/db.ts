import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import type { Db } from '../../server/db/index.ts'
import * as schema from '../../server/db/schema.ts'
import { MIGRATIONS_DIR } from '../../server/db/migrator.ts'

export type TestDb = Db

/**
 * Base éphémère, migrée, pour un test : **Postgres en mémoire** (PGlite).
 *
 * Le même moteur qu'en production — Supabase est un Postgres —, les mêmes
 * migrations, les mêmes contraintes de clés étrangères et de transaction, sans
 * rien à lancer à côté. Chaque test part d'une base vide : un test qui en
 * salit un autre ne peut pas exister.
 *
 * Le schéma est migré une fois, puis **copié** : PGlite met ~1 s à démarrer,
 * une base neuve par test serait insupportable. On garde une instance par
 * fichier de test et l'on vide les tables entre deux — c'est ce que fait
 * `cleanup`.
 */
let partagee: { pg: PGlite, db: Db } | null = null

async function instance(): Promise<{ pg: PGlite, db: Db }> {
  if (!partagee) {
    const pg = await PGlite.create()
    const db = drizzle(pg, { schema }) as unknown as Db
    await migrate(db as never, { migrationsFolder: MIGRATIONS_DIR })
    partagee = { pg, db }
  }
  return partagee
}

/** Les tables applicatives, dans l'ordre : on les vide toutes d'un coup. */
async function viderTables(pg: PGlite): Promise<void> {
  const { rows } = await pg.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
  )
  const noms = rows.map(r => `"${r.table_name}"`)
  if (noms.length > 0) await pg.exec(`TRUNCATE TABLE ${noms.join(', ')} RESTART IDENTITY CASCADE`)
}

export async function createTestDb(): Promise<{ db: TestDb, pg: PGlite, cleanup: () => Promise<void> }> {
  const { pg, db } = await instance()
  await viderTables(pg)
  return {
    db,
    pg,
    cleanup: async () => {
      await viderTables(pg)
    },
  }
}

/** Un utilisateur minimal, pour les tests qui ont juste besoin d'un acteur. */
export async function createTestUser(db: TestDb, id: string, phone: string) {
  await db.insert(schema.users).values({ id, phone })
  return id
}
