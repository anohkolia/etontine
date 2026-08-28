import { getRouterParam } from 'h3'
import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../../../db/index.ts'
import { collectionChannels, tontineChannels } from '../../../../../db/schema.ts'
import { requireUser } from '../../../../../utils/auth.ts'
import { apiError } from '../../../../../utils/errors.ts'

/** Supprime un canal, sauf s'il sert encore à une tontine. */
export default defineEventHandler((event) => {
  const user = requireUser(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw apiError('NOT_FOUND', 'Canal introuvable.')

  const db = useDb()
  const rattachements = db
    .select()
    .from(tontineChannels)
    .where(eq(tontineChannels.channelId, id))
    .all()

  if (rattachements.length > 0) {
    throw apiError(
      'FORBIDDEN',
      'Ce numéro sert encore à une tontine. Rattache-lui un autre canal avant de le retirer.',
    )
  }

  db.delete(collectionChannels)
    .where(and(eq(collectionChannels.id, id), eq(collectionChannels.userId, user.id)))
    .run()

  return { ok: true }
})
