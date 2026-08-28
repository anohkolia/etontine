import { randomUUID } from 'node:crypto'
import { readBody } from 'h3'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { useDb } from '../../../db/index.ts'
import { notificationPreferences } from '../../../db/schema.ts'
import { requireUser } from '../../../utils/auth.ts'
import { validationError } from '../../../utils/errors.ts'

/**
 * Règle les notifications, en général ou pour une tontine.
 *
 * Les plages de silence sont en minutes depuis minuit : `1260` pour 21 h.
 * Elles peuvent traverser minuit — « 21 h à 7 h » est le cas courant.
 */
const preferencesInput = z.object({
  tontineId: z.string().uuid().nullable().default(null),
  pushEnabled: z.boolean().optional(),
  remindersEnabled: z.boolean().optional(),
  quietHoursStart: z.number().int().min(0).max(1439).nullable().optional(),
  quietHoursEnd: z.number().int().min(0).max(1439).nullable().optional(),
})

export default defineEventHandler(async (event) => {
  const user = requireUser(event)
  const parsed = preferencesInput.safeParse(await readBody(event))
  if (!parsed.success) throw validationError(parsed.error)

  const { tontineId, ...champs } = parsed.data
  const db = useDb()

  const [existant] = db
    .select()
    .from(notificationPreferences)
    .where(and(
      eq(notificationPreferences.userId, user.id),
      tontineId === null
        ? isNull(notificationPreferences.tontineId)
        : eq(notificationPreferences.tontineId, tontineId),
    ))
    .limit(1)
    .all()

  if (existant) {
    db.update(notificationPreferences)
      .set(champs)
      .where(eq(notificationPreferences.id, existant.id))
      .run()
    return { ok: true, id: existant.id }
  }

  const id = randomUUID()
  db.insert(notificationPreferences).values({ id, userId: user.id, tontineId, ...champs }).run()
  return { ok: true, id }
})
