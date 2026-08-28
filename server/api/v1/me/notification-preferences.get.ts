import { eq } from 'drizzle-orm'
import { useDb } from '../../../db/index.ts'
import { notificationPreferences, tontines, memberships } from '../../../db/schema.ts'
import { requireUser } from '../../../utils/auth.ts'

/** Mes préférences de notification, générales et par tontine. */
export default defineEventHandler((event) => {
  const user = requireUser(event)
  const db = useDb()

  const reglages = db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, user.id))
    .all()

  const mesTontines = db
    .select({ id: tontines.id, name: tontines.name })
    .from(memberships)
    .innerJoin(tontines, eq(tontines.id, memberships.tontineId))
    .where(eq(memberships.userId, user.id))
    .all()

  return {
    general: reglages.find(r => r.tontineId === null) ?? null,
    parTontine: mesTontines.map(t => ({
      tontineId: t.id,
      tontineName: t.name,
      reglage: reglages.find(r => r.tontineId === t.id) ?? null,
    })),
  }
})
