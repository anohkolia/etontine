import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'

/**
 * Les icônes d'installation, tracées ici plutôt qu'exportées à la main.
 *
 * Chaque plateforme veut les siennes :
 *
 * - Android et les navigateurs Chromium lisent le manifeste : 192 et 512 px,
 *   et une version « maskable » qu'Android découpe à la forme du lanceur ;
 * - l'iPhone et l'iPad **ignorent** les icônes du manifeste et prennent
 *   `apple-touch-icon`. Sans elle, l'écran d'accueil reçoit une capture
 *   réduite de la page ;
 * - Safari sur Mac veut une icône pleine, opaque, de 1024 px pour le Dock ;
 * - les onglets, un favicon.
 *
 * Le monogramme — un « T » blanc sur le vert de la marque — n'est fait que de
 * deux rectangles. On le trace donc au pixel près à chaque taille, sans
 * bibliothèque d'image : les proportions sont celles des icônes d'origine, et
 * les 192 et 512 px en ressortent identiques. Le « T » tient dans le cercle de
 * sécurité des icônes « maskable » (rayon de 40 % du côté) : rien n'est rogné,
 * quelle que soit la forme du lanceur. Un vrai logo remplacera ce script le
 * jour où il existera.
 *
 * `node scripts/icones.ts` réécrit les fichiers de `public/`.
 */

const VERT = [0x0F, 0x6E, 0x5C] as const
const BLANC = [0xFF, 0xFF, 0xFF] as const

/**
 * Le « T », en fractions du côté : la barre, puis le jambage. Les bornes
 * s'arrondissent à l'entier inférieur et l'intervalle est semi-ouvert — c'est
 * ce qui redonne exactement les icônes d'origine.
 */
const RECTANGLES = [
  { x: [0.28, 0.72], y: [0.28, 0.38] },
  { x: [0.45, 0.55], y: [0.38, 0.72] },
] as const

function borne(fraction: number, cote: number): number {
  // 1e-9 : `0.55 * 20` vaut 11.000000000000002, mais un produit qui tomberait
  // juste sous l'entier décalerait d'un pixel tout le trait.
  return Math.floor(fraction * cote + 1e-9)
}

function estBlanc(x: number, y: number, cote: number): boolean {
  return RECTANGLES.some(r =>
    x >= borne(r.x[0], cote) && x < borne(r.x[1], cote)
    && y >= borne(r.y[0], cote) && y < borne(r.y[1], cote),
  )
}

function bloc(type: string, donnees: Buffer): Buffer {
  const longueur = Buffer.alloc(4)
  longueur.writeUInt32BE(donnees.length)
  const corps = Buffer.concat([Buffer.from(type, 'ascii'), donnees])
  const controle = Buffer.alloc(4)
  controle.writeUInt32BE(crc32(corps))
  return Buffer.concat([longueur, corps, controle])
}

/** Un PNG RVB opaque — sans couche alpha : un lanceur n'a rien à laisser transparaître. */
function png(cote: number): Buffer {
  const entete = Buffer.alloc(13)
  entete.writeUInt32BE(cote, 0)
  entete.writeUInt32BE(cote, 4)
  entete[8] = 8 // 8 bits par canal
  entete[9] = 2 // RVB

  const lignes = Buffer.alloc(cote * (1 + cote * 3))
  for (let y = 0; y < cote; y++) {
    const debut = y * (1 + cote * 3) // l'octet de filtre reste à 0 : aucun
    for (let x = 0; x < cote; x++) {
      const [r, v, b] = estBlanc(x, y, cote) ? BLANC : VERT
      lignes[debut + 1 + x * 3] = r
      lignes[debut + 2 + x * 3] = v
      lignes[debut + 3 + x * 3] = b
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    bloc('IHDR', entete),
    bloc('IDAT', deflateSync(lignes, { level: 9 })),
    bloc('IEND', Buffer.alloc(0)),
  ])
}

/** Un `.ico` qui embarque des PNG, comme l'acceptent tous les navigateurs actuels. */
function ico(cotes: number[]): Buffer {
  const images = cotes.map(png)
  const entete = Buffer.alloc(6 + 16 * images.length)
  entete.writeUInt16LE(1, 2) // type : icône
  entete.writeUInt16LE(images.length, 4)

  let position = entete.length
  images.forEach((image, i) => {
    const entree = 6 + 16 * i
    entete[entree] = cotes[i]! % 256 // 0 voudrait dire 256
    entete[entree + 1] = cotes[i]! % 256
    entete.writeUInt16LE(1, entree + 4) // plans
    entete.writeUInt16LE(24, entree + 6) // bits par pixel : du RVB, comme les PNG
    entete.writeUInt32LE(image.length, entree + 8)
    entete.writeUInt32LE(position, entree + 12)
    position += image.length
  })

  return Buffer.concat([entete, ...images])
}

const pourcent = (f: number) => Math.round(f * 100)
const [barre, jambage] = RECTANGLES
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">`
  + `<rect width="100" height="100" fill="#0f6e5c"/>`
  + `<path fill="#fff" d="M${pourcent(barre.x[0])} ${pourcent(barre.y[0])}H${pourcent(barre.x[1])}V${pourcent(barre.y[1])}`
  + `H${pourcent(jambage.x[1])}V${pourcent(jambage.y[1])}H${pourcent(jambage.x[0])}V${pourcent(jambage.y[0])}`
  + `H${pourcent(barre.x[0])}Z"/></svg>\n`

const PUBLIC = join(import.meta.dirname, '..', 'public')

const FICHIERS: Array<[string, Buffer | string]> = [
  ['icones/icone-192.png', png(192)],
  ['icones/icone-512.png', png(512)],
  ['icones/icone-512-maskable.png', png(512)],
  ['icones/icone-1024-maskable.png', png(1024)],
  ['icones/icone.svg', svg],
  // À la racine : c'est là que les cherchent les navigateurs et les aperçus de
  // liens qui ne lisent pas les balises `<link>`.
  ['apple-touch-icon.png', png(180)],
  ['favicon.ico', ico([16, 32, 48])],
]

for (const [chemin, contenu] of FICHIERS) {
  writeFileSync(join(PUBLIC, chemin), contenu)
  console.info(`public/${chemin}`)
}
