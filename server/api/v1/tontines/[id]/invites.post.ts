import { getRouterParam } from 'h3'
import { useDb } from '../../../../db/index.ts'
import { creerInvitation } from '../../../../services/invitations.ts'
import { requireMembership } from '../../../../utils/auth.ts'
import { apiError } from '../../../../utils/errors.ts'

/** Crée un lien d'invitation. Réservé au président. */
export default defineEventHandler(async (event) => {
  const tontineId = getRouterParam(event, 'id')
  if (!tontineId) throw apiError('NOT_FOUND', 'Tontine introuvable.')

  const { user } = await requireMembership(event, tontineId, ['president'])
  const invitation = creerInvitation(useDb(), tontineId, user.id)

  const base = process.env.NUXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
  return { ...invitation, url: `${base}/join/${invitation.token}` }
})
