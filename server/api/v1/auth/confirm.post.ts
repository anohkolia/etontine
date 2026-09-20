import { readBody } from 'h3'
import { eq } from 'drizzle-orm'
import { confirmInput } from '../../../../shared/schemas/index.ts'
import { useDb } from '../../../db/index.ts'
import { users } from '../../../db/schema.ts'
import { confirmerEmail } from '../../../services/connexion.ts'
import { createSession } from '../../../utils/session.ts'
import { validationError } from '../../../utils/errors.ts'

/**
 * Confirme une adresse par le lien reçu, et ouvre la session.
 *
 * Le lien prouve la boîte mail et le code vient d'être choisi : redemander le
 * code ici n'ajouterait rien, et ferait perdre au passage quelqu'un qui
 * hésite déjà entre deux.
 */
export default defineEventHandler(async (event) => {
  const parsed = confirmInput.safeParse(await readBody(event))
  if (!parsed.success) throw validationError(parsed.error)

  const db = useDb()
  const { userId, isNewUser } = await confirmerEmail(db, parsed.data.token)

  await createSession(event, userId)

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  return {
    isNewUser,
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
