import { getRouterParam } from 'h3'
import { useDb } from '../../../../../db/index.ts'
import { relancesWhatsApp } from '../../../../../services/rappels.ts'
import { requireMembership } from '../../../../../utils/auth.ts'
import { apiError } from '../../../../../utils/errors.ts'

/**
 * Liens `wa.me` pré-remplis pour relancer les retardataires.
 *
 * **L'envoi reste manuel.** Ce n'est pas une limitation qu'on lèvera plus
 * tard : une relance envoyée automatiquement au nom du trésorier détruirait la
 * seule chose qui fait fonctionner une tontine — le fait que ce soit une
 * personne qui parle à une autre.
 */
export default defineEventHandler(async (event) => {
  const tontineId = getRouterParam(event, 'id')
  if (!tontineId) throw apiError('NOT_FOUND', 'Tontine introuvable.')

  await requireMembership(event, tontineId, ['treasurer', 'president'])

  return {
    envoiManuel: true,
    relances: relancesWhatsApp(useDb(), tontineId),
  }
})
