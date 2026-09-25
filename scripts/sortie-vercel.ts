import { cpSync, existsSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Remonte la sortie de build d'une application secondaire à la racine du dépôt.
 *
 * Le back-office n'a **pas** de `package.json` : ce n'est pas un projet npm
 * autonome, c'est une seconde application Nuxt construite depuis la racine
 * (`nuxt build admin`). Vercel ne peut donc pas le déployer avec
 * « Root Directory = admin » : il installerait dans un dossier sans
 * dépendances, et `nuxt` y serait introuvable.
 *
 * Le dépôt entier est donc la racine du projet Vercel, et c'est la sortie qu'on
 * déplace : Nitro l'écrit dans `admin/.vercel/output`, Vercel la cherche dans
 * `.vercel/output` (Build Output API v3). Une copie, et le tour est joué —
 * plutôt que de dupliquer la liste des dépendances dans un second
 * `package.json`, ce qui ferait deux sources de vérité sur les versions.
 */
const racine = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const application = process.argv[2] ?? 'admin'

const source = join(racine, application, '.vercel', 'output')
const destination = join(racine, '.vercel', 'output')

if (!existsSync(source)) {
  console.error(
    `Sortie introuvable : ${source}\n`
    + `Lance d'abord « nuxt build ${application} ».`,
  )
  process.exit(1)
}

// La destination est effacée d'abord : un reste de build précédent — celui de
// l'application des membres, par exemple — servirait des fonctions qui ne
// correspondent plus au code déployé.
rmSync(destination, { recursive: true, force: true })
cpSync(source, destination, { recursive: true })

console.log(`Sortie de « ${application} » déplacée vers .vercel/output`)
