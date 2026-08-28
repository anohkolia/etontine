import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Résout `DATABASE_URL` en chemin de fichier SQLite et garantit que le dossier
 * parent existe — ni `better-sqlite3` ni `drizzle-kit` ne le créent.
 * Partagé entre le client applicatif et la configuration des migrations.
 */
export function resolveSqliteFile(): string {
  const url = process.env.DATABASE_URL ?? 'file:./data/tontine.sqlite'
  const file = url.startsWith('file:') ? url.slice('file:'.length) : url
  mkdirSync(dirname(file), { recursive: true })
  return file
}
