import { getRequestIP, readBody } from 'h3'
import { eq } from 'drizzle-orm'
import { loginInput } from '../../../../shared/schemas/index.ts'
import { useDb } from '../../../../server/db/index.ts'
import { users } from '../../../../server/db/schema.ts'
import { connecter, limiterParIp } from '../../../../server/services/connexion.ts'
import { estAdministrateur } from '../../../../server/utils/admin.ts'
import { createSession } from '../../../../server/utils/session.ts'
import { apiError, validationError } from '../../../../server/utils/errors.ts'

/**
 * Connexion au back-office : numéro et code d'accès, comme côté membre.
 *
 * **Le filtre est ici**, et pas seulement à l'affichage : un numéro absent de
 * la liste blanche n'obtient aucune session sur cette application, même avec
 * le bon code. Sans cela, n'importe quel membre pourrait ouvrir une session
 * sur le back-office et il ne resterait plus qu'une garde par route à oublier.
 *
 * Le code est vérifié **avant** de refuser un numéro non autorisé : répondre
 * plus vite pour lui le désignerait comme tel. Un administrateur s'inscrit
 * comme tout le monde sur l'application des membres — `pnpm db:admin` ne fait
 * que réserver la ligne, l'inscription lui donne son e-mail et son code.
 */
export default defineEventHandler(async (event) => {
  limiterParIp(getRequestIP(event, { xForwardedFor: true }))

  const parsed = loginInput.safeParse(await readBody(event))
  if (!parsed.success) throw validationError(parsed.error)

  const db = useDb()
  const { userId } = await connecter(db, parsed.data.phone, parsed.data.code)

  if (!estAdministrateur(parsed.data.phone)) throw apiError('UNAUTHENTICATED', 'Accès refusé.')

  const [utilisateur] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  if (!utilisateur) throw apiError('UNAUTHENTICATED', 'Accès refusé.')

  await createSession(event, utilisateur.id)

  return { phone: utilisateur.phone, firstName: utilisateur.firstName, lastName: utilisateur.lastName }
})
