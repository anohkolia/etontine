import { getQuery } from 'h3'
import { useDb } from '../../../../server/db/index.ts'
import { demandesEnAttente, demandesTraitees } from '../../../../server/services/abonnement.ts'
import { requireAdmin } from '../../utils/garde.ts'

/** La file des demandes d'abonnement : en attente par défaut, traitées sur demande. */
export default defineEventHandler(async (event) => {
  requireAdmin(event)

  const db = useDb()
  const traitees = getQuery(event).etat === 'traitees'

  return {
    etat: traitees ? 'traitees' : 'en_attente',
    demandes: traitees ? (await demandesTraitees(db)) : (await demandesEnAttente(db)),
    nbEnAttente: (await demandesEnAttente(db)).length,
  }
})
