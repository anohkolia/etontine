import { getQuery, getRouterParam, setHeader } from 'h3'
import { useDb } from '../../../../../server/db/index.ts'
import { journaliserConsultation, urlPiece } from '../../../../../server/services/kyc.ts'
import { apiError } from '../../../../../server/utils/errors.ts'
import { decomposerUrlPiece, lirePiece } from '../../../../../server/utils/fichiers.ts'
import { requireAdmin } from '../../../utils/garde.ts'

/**
 * Sert une pièce d'identité à l'administrateur.
 *
 * **Chaque consultation est journalisée.** Regarder la pièce d'identité de
 * quelqu'un est une action, pas une simple lecture : c'est la donnée la plus
 * sensible que l'application détient. Le journal ne l'empêche pas, il la rend
 * traçable — et c'est cette traçabilité qui dissuade de fouiller par curiosité.
 *
 * Rien n'est mis en cache : une pièce d'identité ne doit pas traîner dans le
 * cache d'un navigateur partagé de bureau.
 */
export default defineEventHandler(async (event) => {
  const admin = requireAdmin(event)

  const id = getRouterParam(event, 'id')
  const type = getQuery(event).type === 'selfie' ? 'selfie' : 'document'
  if (!id) throw apiError('NOT_FOUND', 'Pièce introuvable.')

  const db = useDb()
  const url = urlPiece(db, id, type)
  if (!url) throw apiError('NOT_FOUND', 'Pièce introuvable.')

  const emplacement = decomposerUrlPiece(url)
  if (!emplacement) throw apiError('NOT_FOUND', 'Pièce introuvable.')

  const piece = await lirePiece(emplacement.userId, emplacement.nom)
  if (!piece) throw apiError('NOT_FOUND', 'Pièce introuvable.')

  journaliserConsultation(db, admin, id, type)

  setHeader(event, 'content-type', piece.type)
  setHeader(event, 'cache-control', 'no-store')
  setHeader(event, 'x-content-type-options', 'nosniff')

  return piece.contenu
})
