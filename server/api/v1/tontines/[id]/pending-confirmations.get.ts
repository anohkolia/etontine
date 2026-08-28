import { getRouterParam } from 'h3'
import { useDb } from '../../../../db/index.ts'
import { fileDAttente } from '../../../../services/confirmations.ts'
import { requireMembership } from '../../../../utils/auth.ts'
import { apiError } from '../../../../utils/errors.ts'

/** La file de confirmation du trésorier. */
export default defineEventHandler(async (event) => {
  const tontineId = getRouterParam(event, 'id')
  if (!tontineId) throw apiError('NOT_FOUND', 'Tontine introuvable.')

  const { user } = await requireMembership(event, tontineId, ['treasurer', 'president'])
  const items = fileDAttente(useDb(), tontineId)

  return {
    items: items.map(item => ({
      ...item,
      // Le client sait ainsi masquer le bouton ; le serveur refuse de toute
      // façon (403), l'affichage n'est qu'un confort.
      estLaMienne: item.declaredBy === user.id,
    })),
  }
})
