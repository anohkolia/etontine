import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type Database from 'better-sqlite3'

const HERE = dirname(fileURLToPath(import.meta.url))
export const MIGRATIONS_DIR = join(HERE, 'migrations')

/** Le nom des migrations, dans l'ordre d'application. */
export function migrationNames(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort()
    .map(f => f.replace(/\.sql$/, ''))
}

/**
 * Annule la dernière migration appliquée.
 *
 * `drizzle-kit` ne sait faire que la montée. La descente vit dans
 * `migrations/down/<nom>.down.sql`, écrite à la main, et l'on retire la ligne
 * correspondante de la table de suivi de Drizzle pour que la montée suivante
 * rejoue la migration.
 */
export function rollbackLast(sqlite: Database.Database): string | null {
  const suivi = sqlite
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'`)
    .get()

  if (!suivi) return null

  // On identifie la ligne par son empreinte, pas par `id` : Drizzle déclare
  // cette colonne en `SERIAL`, mot-clé que SQLite ne connaît pas — `id` y vaut
  // donc `NULL`, et un `WHERE id = NULL` ne supprime jamais rien. La migration
  // resterait marquée comme appliquée, et la remontée ne ferait rien du tout.
  const derniere = sqlite
    .prepare(`SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1`)
    .get() as { hash: string, created_at: number } | undefined

  if (!derniere) return null

  // La table de suivi ne stocke pas le nom : on retrouve la migration par sa
  // position, l'ordre d'application étant celui du journal.
  const appliquees = sqlite
    .prepare(`SELECT COUNT(*) AS n FROM __drizzle_migrations`)
    .get() as { n: number }
  const nom = migrationNames()[appliquees.n - 1]

  if (!nom) {
    throw new Error(
      `Impossible de retrouver la migration en position ${appliquees.n}. `
      + 'Le dossier migrations/ et la table __drizzle_migrations divergent.',
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

  sqlite.transaction(() => {
    for (const instruction of instructions) sqlite.exec(instruction)
    sqlite
      .prepare(`DELETE FROM __drizzle_migrations WHERE hash = ? AND created_at = ?`)
      .run(derniere.hash, derniere.created_at)
  })()

  return nom
}

/**
 * Annule toutes les migrations appliquées, de la plus récente à la plus
 * ancienne. Sert au contrôle de réversibilité et à `pnpm db:reset`.
 */
export function rollbackAll(sqlite: Database.Database): string[] {
  const annulees: string[] = []
  let nom = rollbackLast(sqlite)
  while (nom) {
    annulees.push(nom)
    nom = rollbackLast(sqlite)
  }
  return annulees
}
