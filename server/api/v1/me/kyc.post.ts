import { readBody } from 'h3'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { useDb } from '../../../db/index.ts'
import { users } from '../../../db/schema.ts'
import { requireUser } from '../../../utils/auth.ts'
import { apiError, validationError } from '../../../utils/errors.ts'
import { isProduction } from '../../../utils/env.ts'

/**
 * Vérification d'identité — palier KYC 2.
 *
 * **Point à trancher avant la mise en production.** La revue des pièces relève
 * d'un back-office, explicitement hors périmètre MVP. Deux comportements
 * cohabitent donc :
 *
 * - en production, le dossier reste en `pending_review` et le palier ne monte
 *   pas. C'est le comportement sûr : personne ne s'auto-certifie ;
 * - hors production, le palier est accordé immédiatement, faute de quoi aucun
 *   parcours de création ne serait ni testable ni démontrable.
 *
 * Tant que le back-office n'existe pas, une tontine ne peut donc pas être
 * créée en production. C'est délibéré et signalé, pas un oubli.
 */
const kycInput = z.object({
  documentUrl: z.string().url(),
  selfieUrl: z.string().url(),
})

export default defineEventHandler(async (event) => {
  const user = requireUser(event)

  if (!user.firstName || !user.lastName) {
    throw apiError(
      'KYC_REQUIRED',
      'Renseigne d’abord ton nom complet.',
      { field: 'firstName', requiredLevel: 1 },
    )
  }

  const parsed = kycInput.safeParse(await readBody(event))
  if (!parsed.success) throw validationError(parsed.error)

  const approbationImmediate = !isProduction()

  useDb().update(users).set({
    kycDocumentUrl: parsed.data.documentUrl,
    kycSelfieUrl: parsed.data.selfieUrl,
    kycSubmittedAt: new Date(),
    kycStatus: approbationImmediate ? 'approved' : 'pending_review',
    ...(approbationImmediate && user.kycLevel < 2 ? { kycLevel: 2 } : {}),
  }).where(eq(users.id, user.id)).run()

  return {
    status: approbationImmediate ? 'approved' as const : 'pending_review' as const,
    kycLevel: approbationImmediate ? 2 : user.kycLevel,
  }
})
