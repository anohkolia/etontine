/**
 * Serveur Postgres local, sans rien installer : PGlite derrière une prise
 * réseau. `pnpm db:local` le lance ; l'application des membres, le
 * back-office et les tests de bout en bout s'y connectent tous par
 * `postgres://…:5433`, comme ils se connecteraient à Supabase.
 *
 * Pourquoi une prise plutôt que PGlite embarqué dans chaque serveur : PGlite
 * n'accepte qu'un processus par dossier de données, et le développement en
 * lance deux — l'application et le back-office. Le multiplexeur de
 * `pglite-socket` sert plusieurs connexions à tour de rôle ; c'est largement
 * assez pour développer et pour jouer les parcours.
 */
import { existsSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'

if (existsSync('.env')) process.loadEnvFile('.env')

const dossier = process.env.PGLITE_DATA_DIR || './data/pglite'
const port = Number(process.env.PGLITE_PORT || 5433)

const db = await PGlite.create({ dataDir: dossier })
const serveur = new PGLiteSocketServer({ db, port, host: '127.0.0.1', maxConnections: 16 })
await serveur.start()

console.info(`[db:local] Postgres (PGlite) prêt sur postgres://postgres:postgres@127.0.0.1:${port}/postgres — données dans ${dossier}`)

const arreter = async () => {
  await serveur.stop()
  await db.close()
  process.exit(0)
}
process.on('SIGINT', arreter)
process.on('SIGTERM', arreter)
