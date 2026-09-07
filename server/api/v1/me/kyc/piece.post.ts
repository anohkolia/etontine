import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readMultipartFormData } from 'h3'
import { requireUser } from '../../../../utils/auth.ts'
import { apiError } from '../../../../utils/errors.ts'
import { racineDesPreuves } from '../../../../utils/fichiers.ts'

/**
 * Dépôt d'une pièce du dossier d'identité.
 *
 * Route distincte de `POST /uploads/proof`, et pas un simple élargissement de
 * celle-ci : une capture de paiement est une image compressée de moins de
 * 200 Ko, une pièce officielle arrive souvent en PDF scanné qu'on ne peut pas
 * compresser dans le navigateur. Mélanger les deux reviendrait à autoriser un
 * PDF de 2 Mo comme preuve de cotisation, ce que personne ne veut.
 *
 * Le stockage et la forme de l'URL restent ceux des preuves : c'est ce que le
 * back-office sait déjà résoudre (`decomposerUrlPiece`).
 */

/** Un PDF scanné ne se compresse pas côté client ; 2 Mo est le plafond retenu. */
const TAILLE_MAX_PDF = 2 * 1024 * 1024

/** Une image, elle, est compressée avant l'envoi — même plafond que les preuves. */
const TAILLE_MAX_IMAGE = 200 * 1024

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
}

export default defineEventHandler(async (event) => {
  const user = requireUser(event)

  const parties = await readMultipartFormData(event)
  const fichier = parties?.find(p => p.name === 'file' && p.filename)

  if (!fichier) throw apiError('VALIDATION_ERROR', 'Aucun fichier reçu.', { field: 'file' })

  const extension = EXTENSIONS[fichier.type ?? '']
  if (!extension) {
    throw apiError(
      'VALIDATION_ERROR',
      'Formats acceptés : PDF, JPG, JPEG et PNG.',
      { field: 'file' },
    )
  }

  const plafond = extension === 'pdf' ? TAILLE_MAX_PDF : TAILLE_MAX_IMAGE
  if (fichier.data.length > plafond) {
    throw apiError(
      'VALIDATION_ERROR',
      extension === 'pdf'
        ? 'Ce PDF dépasse 2 Mo. Scanne la pièce en qualité plus basse.'
        : 'Cette image est trop lourde. Elle doit être compressée avant l’envoi.',
      { field: 'file' },
    )
  }

  const nom = `${randomUUID()}.${extension}`

  // Stockage local : suffisant pour le MVP, à remplacer par un stockage objet
  // le jour où l'application tourne sur plusieurs instances.
  const dossier = join(racineDesPreuves(), user.id)
  await mkdir(dossier, { recursive: true })
  await writeFile(join(dossier, nom), fichier.data)

  return { url: `/api/v1/uploads/proof/${user.id}/${nom}`, size: fichier.data.length }
})
