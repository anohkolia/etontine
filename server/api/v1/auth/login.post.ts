import { getRequestIP, readBody } from 'h3'
import { eq } from 'drizzle-orm'
import { loginInput } from '../../../../shared/schemas/index.ts'
import { useDb } from '../../../db/index.ts'
import { users } from '../../../db/schema.ts'
import { connecter, limiterParIp } from '../../../services/connexion.ts'
import { createSession } from '../../../utils/session.ts'
import { validationError } from '../../../utils/errors.ts'

/**
 * Connexion par numéro et code d'accès.
 *
 * La limitation par adresse tombe **avant** la lecture du corps : elle borne
 * aussi les requêtes malformées, qui coûtent autant à servir.
 */
export default defineEventHandler(async (event) => {
  limiterParIp(getRequestIP(event, { xForwardedFor: true }))

  const parsed = loginInput.safeParse(await readBody(event))
  if (!parsed.success) throw validationError(parsed.error)

  const db = useDb()
  const { userId } = await connecter(db, parsed.data.phone, parsed.data.code)

  await createSession(event, userId)

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  return {
    user: {
      id: user!.id,
      phone: user!.phone,
      email: user!.email,
      firstName: user!.firstName,
      lastName: user!.lastName,
      kycLevel: user!.kycLevel,
    },
  }
})
