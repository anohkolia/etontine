import { getRouterParam } from 'h3'
import { useDb } from '../../../../db/index.ts'
import { verifierQuotaMembres } from '../../../../services/abonnement.ts'
import { creerInvitation } from '../../../../services/invitations.ts'
import { requireMembership } from '../../../../utils/auth.ts'
import { apiError } from '../../../../utils/errors.ts'

/**
 * Crée un lien d'invitation. Réservé au président.
 *
 * **Le lien cesse d'être partageable dès que la limite est atteinte.** Le
 * président l'apprend ici, chez lui, avec le chemin pour la lever — plutôt
 * qu'un arrivant refusé au bout du lien, qui lirait ce refus comme un rejet du
 * groupe. Le contrôle est repris à l'acceptation : entre la création du lien et
 * son usage, des places ont pu se remplir.
 */
export default defineEventHandler(async (event) => {
  const tontineId = getRouterParam(event, 'id')
  if (!tontineId) throw apiError('NOT_FOUND', 'Tontine introuvable.')

  const { user } = await requireMembership(event, tontineId, ['president'])

  const db = useDb()
  verifierQuotaMembres(db, tontineId)

  const invitation = creerInvitation(db, tontineId, user.id)

  const base = process.env.NUXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
  return { ...invitation, url: `${base}/join/${invitation.token}` }
})
