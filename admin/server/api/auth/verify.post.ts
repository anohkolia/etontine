import { readBody } from 'h3'
import { eq } from 'drizzle-orm'
import { otpVerifyInput } from '../../../../shared/schemas/index.ts'
import { useDb } from '../../../../server/db/index.ts'
import { users } from '../../../../server/db/schema.ts'
import { verifyOtp } from '../../../../server/services/otp.ts'
import { estAdministrateur } from '../../../../server/utils/admin.ts'
import { createSession } from '../../../../server/utils/session.ts'
import { apiError, validationError } from '../../../../server/utils/errors.ts'

/**
 * Vérifie le code et ouvre une session d'administration.
 *
 * **Le filtre est ici**, et pas seulement à l'affichage : un numéro absent de
 * la liste blanche n'obtient aucune session sur cette application, même avec
 * un code valide. Sans cela, n'importe quel membre pourrait ouvrir une session
 * sur le back-office et il ne resterait plus qu'une garde par route à oublier.
 *
 * Aucun compte n'est créé ici : contrairement à l'application des membres, un
 * numéro inconnu n'a rien à faire dans le back-office.
 */
export default defineEventHandler(async (event) => {
  const parsed = otpVerifyInput.safeParse(await readBody(event))
  if (!parsed.success) throw validationError(parsed.error)

  if (!estAdministrateur(parsed.data.phone)) {
    // On vérifie tout de même le code avant de refuser : répondre plus vite
    // pour un numéro non autorisé le désignerait comme tel.
    await verifyOtp(useDb(), parsed.data.phone, parsed.data.code).catch(() => null)
    throw apiError('UNAUTHENTICATED', 'Accès refusé.')
  }

  const db = useDb()
  await verifyOtp(db, parsed.data.phone, parsed.data.code)

  const [utilisateur] = db.select().from(users).where(eq(users.phone, parsed.data.phone)).limit(1).all()
  if (!utilisateur) throw apiError('UNAUTHENTICATED', 'Accès refusé.')

  await createSession(event, utilisateur.id)

  return { phone: utilisateur.phone, firstName: utilisateur.firstName, lastName: utilisateur.lastName }
})
