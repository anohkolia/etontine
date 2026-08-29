import type { H3Event } from 'h3'
import type { User } from '../../../server/db/schema.ts'
import { estAdministrateur } from '../../../server/utils/admin.ts'
import { apiError } from '../../../server/utils/errors.ts'

/**
 * Exige un administrateur authentifié.
 *
 * Deux conditions, et les deux sont vérifiées **à chaque appel** : une session
 * ouverte, et un numéro présent dans la liste blanche. La seconde n'est pas
 * mise en cache dans la session : retirer un numéro de la configuration doit
 * couper l'accès au redémarrage suivant, pas à l'expiration du cookie.
 */
export function requireAdmin(event: H3Event): { id: string, phone: string } {
  const user = event.context.user as User | null | undefined

  if (!user) throw apiError('UNAUTHENTICATED', 'Connecte-toi pour continuer.')

  if (!estAdministrateur(user.phone)) {
    // Même message et même code qu'une session absente : un compte de membre
    // qui tâte le back-office n'apprend pas qu'il existe.
    throw apiError('UNAUTHENTICATED', 'Connecte-toi pour continuer.')
  }

  return { id: user.id, phone: user.phone }
}
