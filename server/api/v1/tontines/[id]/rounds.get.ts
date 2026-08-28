import { getRouterParam } from 'h3'
import { useDb } from '../../../../db/index.ts'
import { toursDe } from '../../../../services/tours.ts'
import { requireMembership } from '../../../../utils/auth.ts'
import { apiError } from '../../../../utils/errors.ts'

/** Les tours d'une tontine, du premier au dernier, avec leur bénéficiaire. */
export default defineEventHandler(async (event) => {
  const tontineId = getRouterParam(event, 'id')
  if (!tontineId) throw apiError('NOT_FOUND', 'Tontine introuvable.')

  await requireMembership(event, tontineId)
  const tours = toursDe(useDb(), tontineId)

  return {
    items: tours,
    // Le tour courant est marqué, pour éviter au client de le déduire.
    currentIndex: tours.find(t => t.status === 'collecting' || t.status === 'payout_pending')?.index ?? null,
  }
})
