import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sql } from 'drizzle-orm'
import { migrate as migratePostgresJs } from 'drizzle-orm/postgres-js/migrator'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type { Db } from './index.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
export const MIGRATIONS_DIR = join(HERE, 'migrations')

/** Le nom des migrations, dans l'ordre d'application. */
export function migrationNames(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort()
    .map(f => f.replace(/\.sql$/, ''))
}

/** Applique les migrations manquantes sur une base `postgres-js` (Supabase, PGlite local). */
export async function migrer(db: PostgresJsDatabase<Record<string, unknown>>): Promise<void> {
  await migratePostgresJs(db, { migrationsFolder: MIGRATIONS_DIR })
}

/**
 * Le journal de Drizzle : table `drizzle.__drizzle_migrations`, une ligne par
 * migration appliquée, dans l'ordre. Elle ne stocke pas le nom : on retrouve
 * la migration par sa position, l'ordre d'application étant celui du journal.
 */
async function journal(db: Db): Promise<Array<{ id: number, hash: string }>> {
  const existe = await db.execute(sql`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'
  `)
  if (lignes(existe).length === 0) return []

  const rows = await db.execute(sql`SELECT id, hash FROM drizzle.__drizzle_migrations ORDER BY created_at ASC, id ASC`)
  return lignes(rows) as Array<{ id: number, hash: string }>
}

/** Les lignes d'un `execute`, quel que soit le pilote (postgres-js rend un tableau, PGlite un objet `rows`). */
function lignes(resultat: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(resultat)) return resultat as Array<Record<string, unknown>>
  const r = resultat as { rows?: Array<Record<string, unknown>> }
  return r.rows ?? []
}

/**
 * Annule la dernière migration appliquée.
 *
 * `drizzle-kit` ne sait faire que la montée. La descente vit dans
 * `migrations/down/<nom>.down.sql`, écrite à la main, et l'on retire la ligne
 * correspondante du journal pour que la montée suivante rejoue la migration.
 */
export async function rollbackLast(db: Db): Promise<string | null> {
  const appliquees = await journal(db)
  const derniere = appliquees.at(-1)
  if (!derniere) return null

  const nom = migrationNames()[appliquees.length - 1]
  if (!nom) {
    throw new Error(
      `Impossible de retrouver la migration en position ${appliquees.length}. `
      + 'Le dossier migrations/ et le journal drizzle.__drizzle_migrations divergent.',
    )
  }

  const chemin = join(MIGRATIONS_DIR, 'down', `${nom}.down.sql`)
  let sqlDescente: string
  try {
    sqlDescente = readFileSync(chemin, 'utf8')
  }
  catch {
    throw new Error(
      `Migration ${nom} irréversible : ${chemin} est absent. `
      + 'Toute migration doit avoir sa descente (acceptation T04).',
    )
  }

  const instructions = sqlDescente
    .split('--> statement-breakpoint')
    .map(s => s.trim())
    .filter(s => s.length > 0)

  await db.transaction(async (tx) => {
    for (const instruction of instructions) await tx.execute(sql.raw(instruction))
    await tx.execute(sql`DELETE FROM drizzle.__drizzle_migrations WHERE id = ${derniere.id}`)
  })

  return nom
}

/**
 * Annule toutes les migrations appliquées, de la plus récente à la plus
 * ancienne. Sert au contrôle de réversibilité et à `pnpm db:reset`.
 */
export async function rollbackAll(db: Db): Promise<string[]> {
  const annulees: string[] = []
  let nom = await rollbackLast(db)
  while (nom) {
    annulees.push(nom)
    nom = await rollbackLast(db)
  }
  return annulees
}
