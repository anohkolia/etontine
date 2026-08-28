import { readFileSync, readdirSync, statSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join } from 'node:path'

/**
 * Contrôle du lot client après build.
 *
 * Deux vérifications, toutes deux exigées par CLAUDE.md :
 *
 * 1. **Aucune bibliothèque serveur dans le lot client** (règle 17). `pdfkit`,
 *    `exceljs` et consorts pèsent chacun plus lourd que toute l'application ;
 *    un `import` mal placé les y ferait basculer sans que rien n'échoue.
 * 2. **Les budgets de poids** (règle 15) : moins de 180 Ko de JS initial,
 *    moins de 250 Ko au premier chargement hors images.
 *
 * Le coût mesuré est le coût **bloquant** : `modulepreload`, feuilles de style
 * et `preload`. Les `prefetch` partent au repos, après le rendu, et les compter
 * donnerait une image faussement alarmante.
 */
const RACINE = join(process.cwd(), '.output', 'public')

/** Bibliothèques qui n'ont rien à faire côté client, et leur empreinte. */
const INTERDITES: Array<{ nom: string, marqueurs: string[] }> = [
  { nom: 'pdfkit', marqueurs: ['PDFDocument', 'AFMFont', '/Helvetica-Bold'] },
  { nom: 'exceljs', marqueurs: ['xl/workbook.xml', 'ExcelJS'] },
  { nom: 'jspdf', marqueurs: ['jsPDF'] },
  { nom: 'xlsx (SheetJS)', marqueurs: ['SheetJS'] },
  { nom: 'better-sqlite3', marqueurs: ['better_sqlite3.node'] },
  { nom: 'web-push', marqueurs: ['vapidHelper', 'setVapidDetails'] },
]

const BUDGET_JS_KO = 180
const BUDGET_TOTAL_KO = 250
/** Ce que coûte le passage d'un écran à l'autre, une fois l'application chargée. */
const BUDGET_NAVIGATION_KO = 40

function fichiers(dossier: string): string[] {
  return readdirSync(dossier).flatMap((f) => {
    const chemin = join(dossier, f)
    return statSync(chemin).isDirectory() ? fichiers(chemin) : [chemin]
  })
}

function ko(octets: number): string {
  return `${(octets / 1024).toFixed(1)} Ko`
}

const echecs: string[] = []

// ---- 1. Bibliothèques interdites ----
const scripts = fichiers(join(RACINE, '_nuxt')).filter(f => f.endsWith('.js'))

for (const chemin of scripts) {
  const contenu = readFileSync(chemin, 'utf8')
  for (const { nom, marqueurs } of INTERDITES) {
    const trouve = marqueurs.filter(m => contenu.includes(m))
    if (trouve.length > 0) {
      echecs.push(
        `${nom} présent dans le lot client (${chemin.replace(RACINE, '')}) — marqueurs : ${trouve.join(', ')}`,
      )
    }
  }
}

// ---- 2. Budgets de poids ----
const html = readFileSync(join(RACINE, 'index.html'), 'utf8')
const bloquants = new Set<string>()

for (const balise of html.match(/<link\b[^>]*>/g) ?? []) {
  const rel = /rel="([^"]+)"/.exec(balise)?.[1]
  const href = /href="([^"]+)"/.exec(balise)?.[1]
  if (!href?.startsWith('/_nuxt/')) continue
  if (rel === 'modulepreload' || rel === 'stylesheet' || rel === 'preload') bloquants.add(href)
}

let poidsJs = 0
let poidsTotal = 0

for (const href of bloquants) {
  const taille = gzipSync(readFileSync(join(RACINE, href.slice(1))), { level: 9 }).length
  poidsTotal += taille
  if (href.endsWith('.js')) poidsJs += taille
}
poidsTotal += gzipSync(Buffer.from(html), { level: 9 }).length

console.info(`JS initial (compressé)      : ${ko(poidsJs)}  — budget ${BUDGET_JS_KO} Ko`)
console.info(`Premier chargement total    : ${ko(poidsTotal)}  — budget ${BUDGET_TOTAL_KO} Ko`)
console.info(`Fichiers bloquants          : ${bloquants.size}`)

if (poidsJs > BUDGET_JS_KO * 1024) {
  echecs.push(`JS initial à ${ko(poidsJs)}, au-dessus du budget de ${BUDGET_JS_KO} Ko.`)
}
if (poidsTotal > BUDGET_TOTAL_KO * 1024) {
  echecs.push(`Premier chargement à ${ko(poidsTotal)}, au-dessus du budget de ${BUDGET_TOTAL_KO} Ko.`)
}

// ---- 3. Coût d'une navigation ----
// Une fois l'application chargée, changer d'écran ne doit tirer que le morceau
// de la nouvelle route. Le plus lourd de ces morceaux donne le pire cas, et
// c'est lui qu'on compare au budget : un écran qui coûte 200 Ko à ouvrir est
// un écran qu'on n'ouvre pas, sur une connexion facturée à la donnée.
const morceauxDeRoute = scripts.filter(f => !bloquants.has(f.replace(RACINE, '')))

let pire = { fichier: '', taille: 0 }
for (const chemin of morceauxDeRoute) {
  const taille = gzipSync(readFileSync(chemin), { level: 9 }).length
  if (taille > pire.taille) pire = { fichier: chemin.replace(RACINE, ''), taille }
}

console.info(`Navigation la plus lourde   : ${ko(pire.taille)}  — budget ${BUDGET_NAVIGATION_KO} Ko  (${pire.fichier})`)

if (pire.taille > BUDGET_NAVIGATION_KO * 1024) {
  echecs.push(
    `La navigation vers ${pire.fichier} coûte ${ko(pire.taille)}, `
    + `au-dessus du budget de ${BUDGET_NAVIGATION_KO} Ko.`,
  )
}

// ---- 4. Manifeste d'installation ----
// Vérifié sur le build et non en développement : le service worker y est coupé
// pour ne pas interférer avec les tests, et le manifeste n'y est pas servi.
// C'est de toute façon la version livrée qui compte pour l'installation.
const manifestes = fichiers(RACINE).filter(f => f.endsWith('.webmanifest') || f.endsWith('manifest.json'))

if (manifestes.length === 0) {
  echecs.push('Aucun manifeste dans le build : l’application ne s’installe pas.')
}
else {
  const manifeste = JSON.parse(readFileSync(manifestes[0]!, 'utf8')) as {
    name?: string
    short_name?: string
    display?: string
    start_url?: string
    icons?: Array<{ sizes?: string, purpose?: string }>
  }

  if (manifeste.display !== 'standalone') {
    echecs.push(`display vaut « ${manifeste.display} » : l’installation n’ouvrira pas en application.`)
  }
  // Au-delà de douze caractères, Android tronque le nom sous l'icône.
  if ((manifeste.short_name?.length ?? 99) > 12) {
    echecs.push(`short_name trop long (${manifeste.short_name}) : Android le tronquera.`)
  }
  if (manifeste.start_url !== '/app') {
    echecs.push('start_url doit ouvrir l’application, pas la vitrine.')
  }

  const tailles = (manifeste.icons ?? []).map(i => i.sizes)
  for (const attendue of ['192x192', '512x512']) {
    if (!tailles.includes(attendue)) echecs.push(`Icône ${attendue} manquante.`)
  }
  // Sans icône « maskable », Android encadre l'icône dans un carré blanc.
  if (!(manifeste.icons ?? []).some(i => i.purpose === 'maskable')) {
    echecs.push('Aucune icône « maskable » : Android encadrera l’icône dans un carré blanc.')
  }

  console.info(`Manifeste                   : ${manifeste.name} — ${(manifeste.icons ?? []).length} icônes`)
}

if (echecs.length > 0) {
  console.error('\nContrôle du lot client : ÉCHEC')
  for (const e of echecs) console.error(`  · ${e}`)
  process.exit(1)
}

console.info('\nContrôle du lot client : conforme.')
