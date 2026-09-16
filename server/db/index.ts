import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import * as schema from './schema.ts'

/**
 * Le type de base partagé par tous les services.
 *
 * Deux pilotes le produisent : `postgres-js` vers Supabase (ou n'importe quel
 * Postgres, dont le serveur PGlite local), et `pglite` en mémoire dans les
 * tests unitaires. Les services ne voient que ce type ; la requête s'écrit
 * pareil, seul le transport change.
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>

/** Le serveur PGlite local (`pnpm db:local`), quand rien d'autre n'est configuré. */
export const URL_LOCALE = 'postgres://postgres:postgres@127.0.0.1:5433/postgres'

export function databaseUrl(): string {
  return process.env.DATABASE_URL || URL_LOCALE
}

/**
 * Le pooler de Supabase (Supavisor) en mode transaction — port 6543 — ne
 * connaît pas les requêtes préparées : chaque transaction peut tomber sur une
 * autre connexion serveur. `prepare: false` est obligatoire, sinon la seconde
 * requête d'une même forme échoue en « prepared statement already exists ».
 * Le mode session (port 5432) et une connexion directe s'en accommodent.
 */
export function estPoolerTransaction(url: string): boolean {
  return /pooler\.supabase\.com:6543\b/.test(url) || /[?&]pgbouncer=true/.test(url)
}

/** Une base hors de la machine se joint en TLS, sans exception. */
export function estDistante(url: string): boolean {
  return !/@(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\//.test(url)
}

/**
 * Client de base de données — **le seul endroit** qui connaît le pilote.
 *
 * Supabase en production, par `DATABASE_URL`. En développement et en tests de
 * bout en bout, le serveur PGlite lancé par `pnpm db:local` — le même moteur,
 * embarqué, que les deux applications partagent par le protocole Postgres.
 *
 * En serverless, chaque instance de fonction garde une connexion au plus :
 * c'est le pooler côté Supabase qui multiplexe, pas nous. Sur un serveur
 * persistant, un petit pool suffit — l'application est peu concurrente.
 */
let instance: Db | undefined

export function useDb(): Db {
  if (!instance) {
    const url = databaseUrl()
    const serverless = Boolean(process.env.VERCEL || process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME)
    const client = postgres(url, {
      prepare: !estPoolerTransaction(url),
      max: serverless ? 1 : 5,
      ssl: estDistante(url) ? 'require' : undefined,
      connect_timeout: 10,
      // Une connexion qui dort est rendue au pooler : en serverless, elle
      // compterait dans le quota de connexions de tout le monde.
      idle_timeout: serverless ? 20 : 60,
      onnotice: () => {},
    })
    instance = drizzle(client, { schema }) as unknown as Db
  }
  return instance
}

export { schema }
