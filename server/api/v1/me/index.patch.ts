import { readBody } from 'h3'
import { eq } from 'drizzle-orm'
import { profileInput } from '../../../../shared/schemas/index.ts'
import { useDb } from '../../../db/index.ts'
import { users } from '../../../db/schema.ts'
import { requireUser } from '../../../utils/auth.ts'
import { validationError } from '../../../utils/errors.ts'

/**
 * Profil minimal : prénom, nom, avatar.
 *
 * Renseigner son nom fait passer au palier KYC 1, exigé pour rejoindre une
 * tontine (docs/data-model.md §4). On ne redescend jamais un palier : c'est un
 * acquis, pas un état courant.
 */
export default defineEventHandler(async (event) => {
  const user = requireUser(event)
  const parsed = profileInput.partial().safeParse(await readBody(event))
  if (!parsed.success) throw validationError(parsed.error)

  const db = useDb()
  const complet = Boolean(parsed.data.firstName ?? user.firstName) && Boolean(parsed.data.lastName ?? user.lastName)

  db.update(users)
    .set({
      ...parsed.data,
      ...(complet && user.kycLevel < 1 ? { kycLevel: 1 } : {}),
    })
    .where(eq(users.id, user.id))
    .run()

  const [maj] = db.select().from(users).where(eq(users.id, user.id)).limit(1).all()
  return {
    id: maj!.id,
    firstName: maj!.firstName,
    lastName: maj!.lastName,
    avatarUrl: maj!.avatarUrl,
    kycLevel: maj!.kycLevel,
  }
})
