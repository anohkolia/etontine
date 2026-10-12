import { getQuery } from 'h3'
import { useDb } from '../../../../server/db/index.ts'
import { nombreNouveauxOrganisateurs, organisateurs } from '../../../../server/services/organisateurs.ts'
import { requireAdmin } from '../../utils/garde.ts'

/**
 * Les organisateurs : ceux qu'aucun administrateur n'a encore pris en compte
 * par défaut, tous sur demande.
 */
export default defineEventHandler(async (event) => {
  requireAdmin(event)

  const db = useDb()
  const tous = getQuery(event).etat === 'tous'

  return {
    etat: tous ? 'tous' : 'nouveaux',
    organisateurs: await organisateurs(db, tous ? 'tous' : 'nouveaux'),
    nbNouveaux: await nombreNouveauxOrganisateurs(db),
  }
})
