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
 * Options TLS du pilote — l'équivalent de `sslmode=verify-full`.
 *
 * `ssl: 'require'` de postgres-js chiffre mais **ne vérifie pas** le
 * certificat (`rejectUnauthorized: false`) : n'importe qui placé entre
 * l'application et Supabase pourrait se faire passer pour la base et lire les
 * numéros de téléphone qui y transitent. Une base distante est donc toujours
 * vérifiée — chaîne de certification et nom d'hôte. Elle se désigne par son
 * nom, jamais par une adresse IP : c'est contre ce nom que Node contrôle
 * l'identité du certificat.
 *
 * Sans configuration, le magasin de confiance de Node suffit pour une
 * autorité publique. `DATABASE_CA_CERT` (PEM) désigne une autorité privée,
 * celle que Supabase fournit dans son tableau de bord ; renseignée, elle est
 * la **seule** acceptée. Une base dont le certificat n'est pas reconnu est
 * refusée : c'est le défaut sûr. Le serveur PGlite local ne parle pas TLS,
 * on ne lui en demande pas.
 */
export function optionsTls(url: string, env: NodeJS.ProcessEnv = process.env): 'verify-full' | { ca: string } | undefined {
  if (!estDistante(url)) return undefined
  // Les hébergeurs qui ne savent pas stocker une valeur sur plusieurs lignes
  // font écrire les retours à la ligne « \n » : on les rétablit.
  const ca = env.DATABASE_CA_CERT?.replace(/\\n/g, '\n').trim()
  return ca ? { ca } : 'verify-full'
}

/**
 * Refuse un geste destructeur — `db:rollback`, `db:seed`, donc `db:reset` —
 * sur une base hors de la machine.
 *
 * `DATABASE_URL` visera Supabase : le même `pnpm db:reset` qui remet le PGlite
 * local à neuf y annulerait toutes les migrations, puis injecterait les
 * comptes de démonstration dans la base de production. `DATABASE_ALLOW_RESET=1`
 * lève le refus, pour une exécution et en connaissance de cause. Migrer et
 * créer les comptes d'administration ne sont pas concernés : ce sont
 * précisément les gestes qu'on fait en production.
 */
export function refuserBaseDistante(url: string, geste: string, env: NodeJS.ProcessEnv = process.env): void {
  if (!estDistante(url) || env.DATABASE_ALLOW_RESET === '1') return
  throw new Error(
    `« ${geste} » refusé : DATABASE_URL vise une base hors de cette machine (${hoteDe(url)}). `
    + 'Pour le faire quand même, relance avec DATABASE_ALLOW_RESET=1.',
  )
}

/** L'hôte d'une URL de connexion, sans jamais le mot de passe. */
function hoteDe(url: string): string {
  try {
    return new URL(url).host
  }
  catch {
    return 'hôte illisible'
  }
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
      ssl: optionsTls(url),
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
