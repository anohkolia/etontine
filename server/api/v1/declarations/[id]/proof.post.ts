import { getRouterParam, readBody } from 'h3'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { proofUrl } from '../../../../../shared/schemas/index.ts'
import { useDb } from '../../../../db/index.ts'
import { paymentDeclarations } from '../../../../db/schema.ts'
import { requireUser } from '../../../../utils/auth.ts'
import { apiError, validationError } from '../../../../utils/errors.ts'

/**
 * Joint une capture à une déclaration **en attente**.
 *
 * Sans réseau, la déclaration part de la file de mutations et la capture
 * reste sur le téléphone — l'écran promettait « tu pourras la joindre plus
 * tard », et aucune route ne le permettait. Seul l'auteur de la déclaration
 * peut le faire, tant que le trésorier ne s'est pas prononcé, et une seule
 * fois : une preuve qu'on remplace après coup n'est plus une preuve.
 */
const input = z.object({ proofUrl })

export default defineEventHandler(async (event) => {
  const declarationId = getRouterParam(event, 'id')
  if (!declarationId) throw apiError('NOT_FOUND', 'Déclaration introuvable.')

  const user = requireUser(event)
  const parsed = input.safeParse(await readBody(event))
  if (!parsed.success) throw validationError(parsed.error)

  const db = useDb()
  const [declaration] = db
    .select()
    .from(paymentDeclarations)
    .where(eq(paymentDeclarations.id, declarationId))
    .limit(1)
    .all()

  if (!declaration || declaration.declaredBy !== user.id) {
    throw apiError('NOT_FOUND', 'Déclaration introuvable.')
  }
  if (declaration.decision !== 'pending') {
    throw apiError('INVALID_TRANSITION', 'Cette déclaration a déjà été tranchée : la preuve ne se modifie plus.')
  }
  if (declaration.proofUrl) {
    throw apiError('INVALID_TRANSITION', 'Une capture est déjà jointe à cette déclaration.')
  }

  // La capture doit avoir été déposée par l'appelant, comme une preuve jointe
  // à la déclaration elle-même : une adresse étrangère n'en est pas une.
  if (!parsed.data.proofUrl.includes(`/uploads/proof/${user.id}/`)) {
    throw apiError('VALIDATION_ERROR', 'La capture doit être déposée depuis ton compte.', { field: 'proofUrl' })
  }

  db.update(paymentDeclarations)
    .set({ proofUrl: parsed.data.proofUrl })
    .where(eq(paymentDeclarations.id, declarationId))
    .run()

  return { ok: true }
})
