import { getRouterParam } from 'h3'
import { useDb } from '../../../../../db/index.ts'
import { verifyLedger } from '../../../../../services/ledger.ts'
import { requireMembership } from '../../../../../utils/auth.ts'
import { apiError } from '../../../../../utils/errors.ts'

/**
 * Vérification de la chaîne de hachage : `{ valid, brokenAt? }`.
 *
 * Ouvert à tout membre actif, et c'est le point : n'importe qui dans le groupe
 * peut contrôler que le registre n'a pas été retouché, sans avoir à croire le
 * bureau sur parole.
 */
export default defineEventHandler(async (event) => {
  const tontineId = getRouterParam(event, 'id')
  if (!tontineId) throw apiError('NOT_FOUND', 'Tontine introuvable.')

  await requireMembership(event, tontineId)
  return verifyLedger(useDb(), tontineId)
})
