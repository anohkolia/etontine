/**
 * Petit utilitaire en ligne de commande pour ce que `drizzle-kit` ne fait pas.
 * Node 24 lit le TypeScript sans transpilation.
 *
 * Le fichier `.env` est chargé explicitement : Nuxt le fait pour ses propres
 * commandes, mais un script Node ordinaire, non. Sans cela, il faudrait répéter
 * `NUXT_ADMIN_PHONES=…` devant chaque appel — et une variable qu'on retape à
 * la main finit par diverger de celle du serveur.
 */
import { existsSync } from 'node:fs'
import Database from 'better-sqlite3'
import { resolveSqliteFile } from './path.ts'
import { rollbackLast } from './migrator.ts'
import { creerComptesAdministrateurs } from './admin-bootstrap.ts'
import { useDb } from './index.ts'

if (existsSync('.env')) process.loadEnvFile('.env')

const commande = process.argv[2]

if (commande === 'rollback') {
  const sqlite = new Database(resolveSqliteFile())
  sqlite.pragma('foreign_keys = OFF') // on démonte, l'ordre est déjà géré

  const nom = rollbackLast(sqlite)
  console.log(nom ? `Migration annulée : ${nom}` : 'Aucune migration à annuler.')
  sqlite.close()
}
else if (commande === 'admin') {
  const { crees, existants } = creerComptesAdministrateurs(useDb())

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
}
else {
  console.error('Usage : node server/db/cli.ts <rollback|admin>')
  process.exit(1)
}
