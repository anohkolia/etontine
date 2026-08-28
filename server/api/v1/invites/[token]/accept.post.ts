import { getRouterParam } from 'h3'
import { useDb } from '../../../../db/index.ts'
import { accepterInvitation } from '../../../../services/invitations.ts'
import { requireKyc, requireUser } from '../../../../utils/auth.ts'
import { apiError } from '../../../../utils/errors.ts'

/** Rejoindre une tontine. Exige le palier 1 : un nom complet. */
export default defineEventHandler((event) => {
  const token = getRouterParam(event, 'token')
  if (!token) throw apiError('NOT_FOUND', 'Lien d’invitation introuvable.')

  const user = requireUser(event)
  requireKyc(user, 1)

  return accepterInvitation(useDb(), token, user.id)
})
