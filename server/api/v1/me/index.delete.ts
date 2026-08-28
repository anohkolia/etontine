import { eq } from 'drizzle-orm'
import { useDb } from '../../../db/index.ts'
import { users } from '../../../db/schema.ts'
import { blocagesSuppression } from '../../../services/compte.ts'
import { requireUser } from '../../../utils/auth.ts'
import { destroySession } from '../../../utils/session.ts'

/**
 * Demande de suppression du compte.
 *
 * **Refusée s'il reste des tours en cours**, et le refus dit lesquels
 * (acceptation T08). Un « impossible » sans explication, sur une application
 * d'argent partagé, se lit comme une séquestration.
 */
export default defineEventHandler(async (event) => {
  const user = requireUser(event)
  const db = useDb()

  const blocages = blocagesSuppression(db, user.id)
  if (blocages.length > 0) {
    throw createError({
      statusCode: 409,
      statusMessage: 'FORBIDDEN',
      data: {
        error: {
          code: 'FORBIDDEN',
          message: 'Ton compte ne peut pas être supprimé tant que des tours sont en cours.',
        },
        // Hors du bloc `error` : ce n'est pas un détail d'erreur, c'est la
        // liste de ce que le membre doit régler pour pouvoir partir.
        blockers: blocages,
      },
    })
  }

  await destroySession(event)
  db.delete(users).where(eq(users.id, user.id)).run()

  return { ok: true }
})
