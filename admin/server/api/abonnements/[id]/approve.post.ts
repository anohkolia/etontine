import { getRouterParam } from 'h3'
import { useDb } from '../../../../../server/db/index.ts'
import { approuverDemande } from '../../../../../server/services/abonnement.ts'
import { apiError } from '../../../../../server/utils/errors.ts'
import { requireAdmin } from '../../../utils/garde.ts'

/**
 * Approuve une demande : le palier et l'échéance sont posés sur le président.
 *
 * C'est le seul endroit d'où un palier payant peut être accordé. L'application
 * n'encaisse rien : l'administrateur constate le règlement hors application,
 * puis signe ici. La décision est journalisée — elle lève un quota, elle doit
 * avoir un auteur.
 */
export default defineEventHandler((event) => {
  const admin = requireAdmin(event)

  const id = getRouterParam(event, 'id')
  if (!id) throw apiError('NOT_FOUND', 'Demande introuvable.')

  return approuverDemande(useDb(), id, admin)
})
