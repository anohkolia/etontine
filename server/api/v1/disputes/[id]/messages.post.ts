import { getRouterParam, readBody } from 'h3'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { useDb } from '../../../../db/index.ts'
import { disputes, ledgerEntries } from '../../../../db/schema.ts'
import { ajouterMessage } from '../../../../services/litiges.ts'
import { requireMembership } from '../../../../utils/auth.ts'
import { apiError, validationError } from '../../../../utils/errors.ts'

const messageInput = z.object({ message: z.string().trim().min(5).max(1000) })

/**
 * Ajoute un message au fil d'une contestation.
 *
 * Ouvert à **tout membre actif**, pas au seul bureau : une contestation où
 * seul le bureau peut répondre n'est pas une contestation, c'est un guichet.
 * Le fil est ce qui remplace la discussion de vive voix qu'on ne peut pas
 * avoir quand chacun est chez soi.
 */
export default defineEventHandler(async (event) => {
  const disputeId = getRouterParam(event, 'id')
  if (!disputeId) throw apiError('NOT_FOUND', 'Contestation introuvable.')

  const db = useDb()
  const [ligne] = db
    .select({ tontineId: ledgerEntries.tontineId })
    .from(disputes)
    .innerJoin(ledgerEntries, eq(ledgerEntries.id, disputes.ledgerEntryId))
    .where(eq(disputes.id, disputeId))
    .limit(1)
    .all()

  if (!ligne) throw apiError('NOT_FOUND', 'Contestation introuvable.')

  const { user } = await requireMembership(event, ligne.tontineId)

  const parsed = messageInput.safeParse(await readBody(event))
  if (!parsed.success) throw validationError(parsed.error)

  return ajouterMessage(db, disputeId, user.id, parsed.data.message)
})
