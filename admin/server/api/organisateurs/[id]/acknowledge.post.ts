import { getRouterParam } from 'h3'
import { useDb } from '../../../../../server/db/index.ts'
import { prendreEnCompteOrganisateur } from '../../../../../server/services/organisateurs.ts'
import { apiError } from '../../../../../server/utils/errors.ts'
import { requireAdmin } from '../../../utils/garde.ts'

/** Prend en compte l'arrivée d'un organisateur : l'alerte tombe, le geste est journalisé. */
export default defineEventHandler(async (event) => {
  const admin = requireAdmin(event)

  const id = getRouterParam(event, 'id')
  if (!id) throw apiError('NOT_FOUND', 'Organisateur introuvable.')

  return await prendreEnCompteOrganisateur(useDb(), id, admin)
})
