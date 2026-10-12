import { useDb } from '../../../server/db/index.ts'
import { nombreNouveauxOrganisateurs } from '../../../server/services/organisateurs.ts'
import { requireAdmin } from '../utils/garde.ts'

/**
 * Ce qui attend l'attention d'un administrateur, en nombres — de quoi poser un
 * badge sur les onglets sans charger les listes.
 */
export default defineEventHandler(async (event) => {
  requireAdmin(event)
  return { organisateurs: await nombreNouveauxOrganisateurs(useDb()) }
})
