import { useDb } from '../../../server/db/index.ts'
import { journalAdministration } from '../../../server/services/kyc.ts'
import { requireAdmin } from '../utils/garde.ts'

/**
 * Le journal d'administration.
 *
 * Consultable par tout administrateur, y compris pour ses propres actions :
 * un journal que seul son auteur peut relire ne contrôle rien.
 */
export default defineEventHandler((event) => {
  requireAdmin(event)
  return { entrees: journalAdministration(useDb()) }
})
