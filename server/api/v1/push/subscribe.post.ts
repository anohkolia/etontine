import { randomUUID } from 'node:crypto'
import { readBody } from 'h3'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { useDb } from '../../../db/index.ts'
import { pushSubscriptions } from '../../../db/schema.ts'
import { requireUser } from '../../../utils/auth.ts'
import { validationError } from '../../../utils/errors.ts'

const abonnementInput = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
})

/** Enregistre un abonnement Web Push. Idempotent sur l'adresse d'envoi. */
export default defineEventHandler(async (event) => {
  const user = requireUser(event)
  const parsed = abonnementInput.safeParse(await readBody(event))
  if (!parsed.success) throw validationError(parsed.error)

  const db = useDb()
  const [existant] = db
    .select()
    .from(pushSubscriptions)
    .where(and(
      eq(pushSubscriptions.userId, user.id),
      eq(pushSubscriptions.endpoint, parsed.data.endpoint),
    ))
    .limit(1)
    .all()

  if (existant) return { ok: true, id: existant.id }

  const id = randomUUID()
  db.insert(pushSubscriptions).values({
    id,
    userId: user.id,
    endpoint: parsed.data.endpoint,
    p256dh: parsed.data.keys.p256dh,
    auth: parsed.data.keys.auth,
  }).run()

  return { ok: true, id }
})
