import { getSessionUser } from '../../../server/utils/session.ts'

/**
 * Pose l'utilisateur de la session sur le contexte.
 *
 * Le même mécanisme de session que l'application des membres — même table,
 * même cookie `httpOnly`. Mais les deux applications tournant sur des origines
 * distinctes, les cookies ne se partagent pas : se connecter au back-office
 * est un geste séparé, ce qui est exactement ce qu'on veut.
 */
export default defineEventHandler(async (event) => {
  if (!event.path?.startsWith('/api/')) return
  event.context.user = await getSessionUser(event)
})
