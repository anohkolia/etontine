import { getQuery, getRouterParam } from 'h3'
import { useDb } from '../../../../db/index.ts'
import { recu, verifierSignature } from '../../../../services/recus.ts'
import { apiError } from '../../../../utils/errors.ts'

/**
 * Reçu vérifiable. **Consultable sans compte**, via un lien signé.
 *
 * On le partage par WhatsApp, et celui qui le reçoit n'est pas forcément
 * membre. La signature et l'expiration remplacent l'authentification.
 */
export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw apiError('NOT_FOUND', 'Reçu introuvable.')

  const q = getQuery(event)
  verifierSignature(id, String(q.exp ?? ''), String(q.sig ?? ''))

  return recu(useDb(), id)
})
