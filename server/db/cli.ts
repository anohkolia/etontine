/**
 * Petit utilitaire en ligne de commande pour la base : migrer, annuler,
 * créer les comptes d'administration. Node 24 lit le TypeScript sans
 * transpilation.
 *
 * Le fichier `.env` est chargé explicitement : Nuxt le fait pour ses propres
 * commandes, mais un script Node ordinaire, non. Sans cela, il faudrait répéter
 * `DATABASE_URL=…` devant chaque appel — et une variable qu'on retape à la
 * main finit par diverger de celle du serveur.
 *
 * Les migrations visent la base de `DATABASE_URL`. Vers Supabase, utiliser la
 * connexion **directe** ou le pooler en mode session (port 5432) : le mode
 * transaction (6543) ne tient pas les verrous de schéma d'une migration.
 */
import { existsSync } from 'node:fs'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrer, rollbackLast } from './migrator.ts'
import { creerComptesAdministrateurs } from './admin-bootstrap.ts'
import { databaseUrl, estDistante, estPoolerTransaction, useDb } from './index.ts'
import type { Db } from './index.ts'

if (existsSync('.env')) process.loadEnvFile('.env')

const commande = process.argv[2]

/** Une connexion dédiée, fermée à la fin : un script qui ne rend pas la main gêne le pooler. */
function connexion() {
  const url = databaseUrl()
  if (estPoolerTransaction(url)) {
    console.error(
      'DATABASE_URL vise le pooler en mode transaction (port 6543) : les migrations '
      + 'doivent passer par la connexion directe ou le mode session (port 5432).',
    )
    process.exit(1)
  }
  const client = postgres(url, { max: 1, ssl: estDistante(url) ? 'require' : undefined })
  return { client, db: drizzle(client) }
}

try {
  if (commande === 'migrate') {
    const { client, db } = connexion()
    await migrer(db)
    console.log('Migrations appliquées.')
    await client.end()
  }
  else if (commande === 'rollback') {
    const { client, db } = connexion()
    const nom = await rollbackLast(db as unknown as Db)
    console.log(nom ? `Migration annulée : ${nom}` : 'Aucune migration à annuler.')
    await client.end()
  }
  else if (commande === 'admin') {
    const { crees, existants } = await creerComptesAdministrateurs(useDb())

    if (crees.length === 0 && existants.length === 0) {
      console.error(
        'Aucun administrateur configuré. Renseigne NUXT_ADMIN_PHONES avec des '
        + 'numéros séparés par des virgules, puis relance.',
      )
      process.exit(1)
    }

    for (const phone of crees) console.log(`Compte créé   : ${phone}`)
    for (const phone of existants) console.log(`Déjà présent  : ${phone}`)
    console.log(
      '\nCes comptes n’ont aucun droit particulier en base : l’accès au '
      + 'back-office vient de NUXT_ADMIN_PHONES, pas de la base de données.',
    )
    process.exit(0)
  }
  else {
    console.error('Usage : node server/db/cli.ts <migrate|rollback|admin>')
    process.exit(1)
  }
}
catch (e) {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
}
