import { eq } from 'drizzle-orm'
import { useDb } from '../../../db/index.ts'
import { memberships } from '../../../db/schema.ts'
import { requireUser } from '../../../utils/auth.ts'

/**
 * Utilisateur courant et ses adhésions.
 *
 * Les adhésions viennent avec le rôle **par tontine** : le client en a besoin
 * pour afficher ou masquer des actions, mais le serveur ne s'en sert jamais —
 * il revérifie systématiquement (docs/api-contract.md, § Rôles).
 */
export default defineEventHandler(async (event) => {
  const user = requireUser(event)

  const adhesions = useDb()
    .select({
      id: memberships.id,
      tontineId: memberships.tontineId,
      role: memberships.role,
      status: memberships.status,
    })
    .from(memberships)
    .where(eq(memberships.userId, user.id))
    .all()

  return {
    user: {
      id: user.id,
      phone: user.phone,
      firstName: user.firstName,
      lastName: user.lastName,
      avatarUrl: user.avatarUrl,
      kycLevel: user.kycLevel,
      // L'**état** du dossier, pas seulement le palier atteint. Sans lui,
      // quelqu'un dont le dossier attend voit le formulaire de dépôt et
      // redépose, et quelqu'un dont le dossier a été refusé n'apprend jamais
      // pourquoi — alors que la notification de refus l'envoie précisément
      // sur cet écran « pour voir ce qui doit être corrigé ».
      kycStatus: user.kycStatus,
      kycRejectionReason: user.kycRejectionReason,
      kycSubmittedAt: user.kycSubmittedAt,
      hasPin: Boolean(user.pinHash),
    },
    memberships: adhesions,
  }
})
