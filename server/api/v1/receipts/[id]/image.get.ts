import { getQuery, getRouterParam, setHeader } from 'h3'
import { useDb } from '../../../../db/index.ts'
import { recu, recuSvg, verifierSignature } from '../../../../services/recus.ts'
import { apiError } from '../../../../utils/errors.ts'

/**
 * Reçu au format image, pour le partage WhatsApp.
 *
 * SVG : quelques kilo-octets, net à toutes les tailles. Le ticket vise moins de
 * 40 Ko — on est très en dessous, parce qu'aucune police n'est embarquée
 * (règle 16 : police système uniquement).
 */
export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw apiError('NOT_FOUND', 'Reçu introuvable.')

  const q = getQuery(event)
  verifierSignature(id, String(q.exp ?? ''), String(q.sig ?? ''))

  const svg = recuSvg(recu(useDb(), id))

  setHeader(event, 'content-type', 'image/svg+xml')
  setHeader(event, 'cache-control', 'public, max-age=3600')

  return svg
})
