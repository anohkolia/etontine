import { getRouterParam } from 'h3'
import { useDb } from '../../../../db/index.ts'
import { apercuInvitation } from '../../../../services/invitations.ts'
import { apiError } from '../../../../utils/errors.ts'

/**
 * Aperçu **public** d'une invitation. Aucune session requise.
 *
 * C'est le point d'entrée du produit : on reçoit un lien par WhatsApp et on
 * doit pouvoir juger avant de créer un compte.
 */
export default defineEventHandler((event) => {
  const token = getRouterParam(event, 'token')
  if (!token) throw apiError('NOT_FOUND', 'Lien d’invitation introuvable.')

  return apercuInvitation(useDb(), token)
})
