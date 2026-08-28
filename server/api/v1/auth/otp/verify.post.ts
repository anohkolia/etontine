import { readBody } from 'h3'
import { eq } from 'drizzle-orm'
import { otpVerifyInput } from '../../../../../shared/schemas/index.ts'
import { useDb } from '../../../../db/index.ts'
import { users } from '../../../../db/schema.ts'
import { verifyOtp } from '../../../../services/otp.ts'
import { createSession } from '../../../../utils/session.ts'
import { validationError } from '../../../../utils/errors.ts'

/** Vérifie le code, ouvre la session, et dit si le compte vient d'être créé. */
export default defineEventHandler(async (event) => {
  const parsed = otpVerifyInput.safeParse(await readBody(event))
  if (!parsed.success) throw validationError(parsed.error)

  const db = useDb()
  const { userId, isNewUser } = await verifyOtp(db, parsed.data.phone, parsed.data.code)

  await createSession(event, userId)

  const [user] = db.select().from(users).where(eq(users.id, userId)).limit(1).all()
  return {
    isNewUser,
    user: {
      id: user!.id,
      phone: user!.phone,
      firstName: user!.firstName,
      lastName: user!.lastName,
      kycLevel: user!.kycLevel,
    },
  }
})
