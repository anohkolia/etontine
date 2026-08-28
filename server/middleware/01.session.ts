import { getSessionUser } from '../utils/session.ts'

/**
 * Pose l'utilisateur de la session sur le contexte de la requête, pour toutes
 * les routes. Ne refuse rien : les routes publiques (`/invites/:token`,
 * `/recu/:id`) doivent rester accessibles sans compte. C'est `requireUser()`
 * qui exige l'authentification, point d'entrée par point d'entrée.
 */
export default defineEventHandler(async (event) => {
  if (!event.path?.startsWith('/api/')) return
  event.context.user = await getSessionUser(event)
})
