import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

/** Racine du stockage des pièces déposées. */
export function racineDesPreuves(): string {
  return join(process.cwd(), 'data', 'preuves')
}

const EXTENSIONS: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
}

/**
 * Un nom de fichier accepté : un UUID, un point, une extension connue.
 *
 * Le `pdf` n'est déposé que par le dossier d'identité (`POST /me/kyc/piece`) :
 * une pièce officielle circule souvent sous cette forme, alors qu'une capture
 * de paiement reste une image.
 *
 * Volontairement strict et non « nettoyant ». Filtrer les `..` d'un chemin
 * fourni par l'appelant est un jeu qu'on perd tôt ou tard — encodages,
 * séparateurs alternatifs, normalisation Unicode. Un motif fermé ne laisse
 * passer que ce qu'on a soi-même écrit.
 */
const NOM_VALIDE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|pdf)$/

const ID_VALIDE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export interface Piece {
  contenu: Buffer
  type: string
  taille: number
}

/**
 * Lit une pièce déposée.
 *
 * Renvoie `null` plutôt que de lever quand le fichier n'existe pas ou que le
 * nom ne convient pas : l'appelant doit répondre la même chose dans les deux
 * cas, sans quoi la différence de réponse dirait à un curieux quels fichiers
 * existent.
 *
 * Le chemin final est **revérifié** après construction : même avec un motif
 * strict en amont, on ne sert jamais un fichier situé hors de la racine.
 */
export async function lirePiece(userId: string, nom: string): Promise<Piece | null> {
  if (!ID_VALIDE.test(userId) || !NOM_VALIDE.test(nom)) return null

  const racine = resolve(racineDesPreuves())
  const chemin = resolve(join(racine, userId, nom))

  // Ceinture et bretelles : le chemin résolu doit rester sous la racine.
  if (!chemin.startsWith(`${racine}/`)) return null

  try {
    const infos = await stat(chemin)
    if (!infos.isFile()) return null

    return {
      contenu: await readFile(chemin),
      type: EXTENSIONS[nom.split('.').pop()!]!,
      taille: infos.size,
    }
  }
  catch {
    return null
  }
}

/**
 * Décompose l'adresse d'une pièce en propriétaire et nom de fichier.
 *
 * Accepte aussi bien un chemin qu'une URL absolue, et c'est nécessaire : le
 * dépôt (`POST /uploads/proof`) renvoie un **chemin relatif**, tandis que le
 * dossier d'identité (`POST /me/kyc`) valide ses champs comme des **URL
 * absolues**. Un client conforme aux deux stocke donc une adresse absolue.
 * N'accepter que le chemin rendait les pièces d'identité introuvables côté
 * back-office — sans autre symptôme qu'un 404.
 *
 * Seul le chemin est retenu : l'hôte d'origine n'entre jamais dans la
 * résolution du fichier, qui reste ancrée sur le stockage local.
 */
export function decomposerUrlPiece(adresse: string): { userId: string, nom: string } | null {
  let chemin = adresse

  if (/^https?:\/\//i.test(adresse)) {
    try {
      chemin = new URL(adresse).pathname
    }
    catch {
      return null
    }
  }

  const correspondance = /^\/api\/v1\/uploads\/proof\/([^/]+)\/([^/]+)$/.exec(chemin)
  if (!correspondance) return null

  const [, userId, nom] = correspondance
  return ID_VALIDE.test(userId!) && NOM_VALIDE.test(nom!) ? { userId: userId!, nom: nom! } : null
}

/**
 * La nature d'une pièce, déduite de son extension : une image, ou un PDF.
 *
 * Le back-office en a besoin **avant** de demander le fichier : un PDF rendu
 * dans une balise `img` ne donne pas un message d'erreur, il donne une image
 * cassée, et l'administrateur conclut que la personne n'a rien déposé.
 */
export function natureDePiece(adresse: string): 'image' | 'pdf' | null {
  const emplacement = decomposerUrlPiece(adresse)
  if (!emplacement) return null
  return emplacement.nom.endsWith('.pdf') ? 'pdf' : 'image'
}
