import { deflateSync } from 'node:zlib'

function crc32(buffer: Buffer): number {
  let table = crc32.table
  if (!table) {
    table = crc32.table = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
      table[n] = c
    }
  }

  let crc = -1
  for (const octet of buffer) crc = table[(crc ^ octet) & 0xFF]! ^ (crc >>> 8)
  return (crc ^ -1) >>> 0
}
crc32.table = undefined as Int32Array | undefined

function chunk(type: string, donnees: Buffer): Buffer {
  const longueur = Buffer.alloc(4)
  longueur.writeUInt32BE(donnees.length)

  const corps = Buffer.concat([Buffer.from(type, 'ascii'), donnees])
  const controle = Buffer.alloc(4)
  controle.writeUInt32BE(crc32(corps))

  return Buffer.concat([longueur, corps, controle])
}

/**
 * Fabrique un PNG de bruit aléatoire, volontairement lourd.
 *
 * Écrit à la main plutôt qu'emprunté à une bibliothèque : il ne s'agit que
 * d'assembler trois blocs PNG, et l'important est que l'image soit
 * **incompressible**. Un dégradé se comprimerait à quelques kilo-octets et le
 * test de compression ne prouverait rien — c'est bien une photo de 4 Mo qu'on
 * veut soumettre au compresseur.
 */
export function pngLourd(cote = 1_200): Buffer {
  const entete = Buffer.alloc(13)
  entete.writeUInt32BE(cote, 0)
  entete.writeUInt32BE(cote, 4)
  entete[8] = 8 // 8 bits par canal
  entete[9] = 2 // couleur RVB
  entete[10] = 0
  entete[11] = 0
  entete[12] = 0

  // Une ligne PNG = un octet de filtre + trois octets par pixel.
  const lignes: Buffer[] = []
  for (let y = 0; y < cote; y++) {
    const ligne = Buffer.alloc(1 + cote * 3)
    ligne[0] = 0 // filtre « aucun »
    for (let i = 1; i < ligne.length; i++) ligne[i] = Math.floor(Math.random() * 256)
    lignes.push(ligne)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', entete),
    chunk('IDAT', deflateSync(Buffer.concat(lignes), { level: 1 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
