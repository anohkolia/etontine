import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readMultipartFormData } from 'h3'
import { requireUser } from '../../../utils/auth.ts'
import { apiError } from '../../../utils/errors.ts'

/**
 * Dépôt d'une capture de paiement.
 *
 * Le serveur **rejette au-delà de 200 Ko** (docs/api-contract.md). Le client
 * compresse à moins de 100 Ko avant l'envoi (règle 18) ; la limite serveur est
 * plus haute pour tolérer une compression imparfaite, mais elle existe : sur un
 * forfait ivoirien, laisser passer une photo de 4 Mo coûte de l'argent réel au
 * membre, et remplit le disque du serveur pour rien.
 */
const TAILLE_MAX = 200 * 1024

const TYPES_ACCEPTES = new Set(['image/jpeg', 'image/png', 'image/webp'])

export default defineEventHandler(async (event) => {
  const user = requireUser(event)

  const parties = await readMultipartFormData(event)
  const fichier = parties?.find(p => p.name === 'file' && p.filename)

  if (!fichier) throw apiError('VALIDATION_ERROR', 'Aucun fichier reçu.', { field: 'file' })

  if (fichier.data.length > TAILLE_MAX) {
    throw apiError(
      'VALIDATION_ERROR',
      'Cette image est trop lourde. Elle doit être compressée avant l’envoi.',
      { field: 'file' },
    )
  }

  const type = fichier.type ?? ''
  if (!TYPES_ACCEPTES.has(type)) {
    throw apiError(
      'VALIDATION_ERROR',
      'Seules les images JPEG, PNG et WebP sont acceptées.',
      { field: 'file' },
    )
  }

  const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[type]!
  const nom = `${randomUUID()}.${extension}`

  // Stockage local : suffisant pour le MVP, à remplacer par un stockage objet
  // le jour où l'application tourne sur plusieurs instances.
  const dossier = join(process.cwd(), 'data', 'preuves', user.id)
  await mkdir(dossier, { recursive: true })
  await writeFile(join(dossier, nom), fichier.data)

  return { url: `/api/v1/uploads/proof/${user.id}/${nom}`, size: fichier.data.length }
})
