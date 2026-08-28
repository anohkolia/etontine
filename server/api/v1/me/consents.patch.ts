import { readBody } from 'h3'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { useDb } from '../../../db/index.ts'
import { users } from '../../../db/schema.ts'
import { requireUser } from '../../../utils/auth.ts'
import { validationError } from '../../../utils/errors.ts'

/**
 * Consentements granulaires.
 *
 * **Deux consentements distincts**, jamais fusionnés en une case unique
 * (acceptation T08) : accepter le traitement de ses données pour faire
 * fonctionner sa tontine n'est pas accepter de recevoir des notifications.
 * Les regrouper reviendrait à extorquer le second en échange du premier.
 */
const consentsInput = z.object({
  data: z.boolean().optional(),
  notifications: z.boolean().optional(),
})

export default defineEventHandler(async (event) => {
  const user = requireUser(event)
  const parsed = consentsInput.safeParse(await readBody(event))
  if (!parsed.success) throw validationError(parsed.error)

  const maintenant = new Date()
  const modifications: Record<string, Date | null> = {}

  if (parsed.data.data !== undefined) {
    modifications.consentDataAt = parsed.data.data ? maintenant : null
  }
  if (parsed.data.notifications !== undefined) {
    modifications.consentNotificationsAt = parsed.data.notifications ? maintenant : null
  }

  const db = useDb()
  db.update(users).set(modifications).where(eq(users.id, user.id)).run()

  const [maj] = db.select().from(users).where(eq(users.id, user.id)).limit(1).all()
  return {
    data: maj!.consentDataAt !== null,
    notifications: maj!.consentNotificationsAt !== null,
  }
})
