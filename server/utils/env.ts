/**
 * Détection de l'environnement, en un seul endroit.
 *
 * `import.meta.dev` est une construction de Vite : elle vaut `undefined` dès
 * qu'on sort du serveur Nuxt — sous Vitest, dans `pnpm db:seed`, dans un script
 * lancé à la main. S'y fier produit des comportements silencieusement
 * différents selon le contexte d'exécution, ce qui est exactement ce qu'on ne
 * veut pas sur du code qui décide d'un cookie `Secure` ou de l'exposition d'un
 * code à usage unique.
 *
 * `NODE_ENV` est posé partout : `development` par Nuxt, `test` par Vitest,
 * `production` au build.
 */
export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production'
}

/** Vrai en développement **et** en test : les deux ont droit aux facilités de mise au point. */
export function isDevOrTest(): boolean {
  return !isProduction()
}
