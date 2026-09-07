import { readBody } from 'h3'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { useDb } from '../../../db/index.ts'
import { users } from '../../../db/schema.ts'
import { requireUser } from '../../../utils/auth.ts'
import { apiError, validationError } from '../../../utils/errors.ts'
import { isProduction } from '../../../utils/env.ts'
import { decomposerUrlPiece } from '../../../utils/fichiers.ts'

/**
 * Vérification d'identité — palier KYC 2.
 *
 * Deux comportements, selon l'environnement :
 *
 * - **en production**, le dossier part en `pending_review` et le palier ne
 *   monte pas. Un administrateur l'examine depuis le back-office (`admin/`) :
 *   personne ne s'auto-certifie, et approuver une pièce d'identité, c'est
 *   autoriser quelqu'un à collecter l'argent d'un groupe ;
 * - **hors production**, le palier est accordé immédiatement. Sans cela, chaque
 *   test du parcours de création exigerait qu'un administrateur intervienne, ce
 *   qui rendrait la suite de bout en bout inutilisable.
 *
 * Le parcours d'examen reste couvert : les tests du back-office placent
 * eux-mêmes un dossier en attente pour l'éprouver.
 *
 * Les deux adresses doivent désigner une pièce **déposée ici par l'appelant**,
 * via `POST /me/kyc/piece`. Accepter une URL quelconque laissait passer un lien
 * externe — l'administrateur ouvrait alors une adresse choisie par la personne
 * qu'il examine — et laissait désigner la pièce de quelqu'un d'autre.
 */
const kycInput = z.object({
  documentUrl: z.string(),
  selfieUrl: z.string(),
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

  for (const [champ, adresse] of [
    ['documentUrl', parsed.data.documentUrl],
    ['selfieUrl', parsed.data.selfieUrl],
  ] as const) {
    if (decomposerUrlPiece(adresse)?.userId !== user.id) {
      throw apiError(
        'VALIDATION_ERROR',
        'Dépose la pièce depuis cet écran avant de l’envoyer.',
        { field: champ },
      )
    }
  }

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
