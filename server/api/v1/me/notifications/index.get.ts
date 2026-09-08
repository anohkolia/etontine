import { getQuery } from 'h3'
import { useDb } from '../../../../db/index.ts'
import { mesNotifications } from '../../../../services/notifications.ts'
import { requireUser } from '../../../../utils/auth.ts'

/**
 * Mes notifications, de la plus récente à la plus ancienne.
 *
 * `unread` porte sur toutes, pas sur la page rendue : c'est le nombre que
 * l'en-tête affiche, et il serait faux s'il ne comptait que ce qui est chargé.
 */
export default defineEventHandler((event) => {
  const user = requireUser(event)
  const q = getQuery(event)

  return mesNotifications(useDb(), user.id, {
    limit: q.limit ? Number(q.limit) : undefined,
    cursor: q.cursor ? Number(q.cursor) : undefined,
  })
})
