import { getQuery } from 'h3'
import { useDb } from '../../../../server/db/index.ts'
import { dossiersEnAttente, dossiersTraites } from '../../../../server/services/kyc.ts'
import { requireAdmin } from '../../utils/garde.ts'

/** La file des dossiers d'identité : en attente par défaut, traités sur demande. */
export default defineEventHandler((event) => {
  requireAdmin(event)

  const db = useDb()
  const traites = getQuery(event).etat === 'traites'

  return {
    etat: traites ? 'traites' : 'en_attente',
    dossiers: traites ? dossiersTraites(db) : dossiersEnAttente(db),
    nbEnAttente: dossiersEnAttente(db).length,
  }
})
