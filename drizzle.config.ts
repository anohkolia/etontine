import { existsSync } from 'node:fs'
import { defineConfig } from 'drizzle-kit'

// `drizzle-kit generate` lit le schéma ; `db:migrate` passe par
// `server/db/cli.ts`, qui vise la base de `DATABASE_URL` — Supabase, ou le
// serveur PGlite local — avec le même migrateur qu'en production.
if (existsSync('.env')) process.loadEnvFile('.env')

export default defineConfig({
  dialect: 'postgresql',
  schema: './server/db/schema.ts',
  out: './server/db/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5433/postgres',
  },
  strict: true,
  verbose: true,
})
