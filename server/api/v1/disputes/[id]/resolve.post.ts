import { getRouterParam, readBody } from 'h3'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { useDb } from '../../../../db/index.ts'
import { disputes, ledgerEntries } from '../../../../db/schema.ts'
import { resoudreContestation } from '../../../../services/litiges.ts'
import { requireMembership } from '../../../../utils/auth.ts'
import { apiError, validationError } from '../../../../utils/errors.ts'

const resolutionInput = z.object({ resolution: z.string().trim().min(5).max(1000) })

/**
 * Clôt une contestation — président ou censeur.
 *
 * La conclusion est **écrite**, pas seulement décidée : le fil reste
 * consultable, et la conclusion avec. Une contestation close sans un mot
 * laisse le doute exactement là où il était, et c'est ce doute qui fait
 * quitter une tontine.
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

  const { user } = await requireMembership(event, ligne.tontineId, ['president', 'auditor'])

  const parsed = resolutionInput.safeParse(await readBody(event))
  if (!parsed.success) throw validationError(parsed.error)

  return resoudreContestation(db, disputeId, user.id, parsed.data.resolution)
})
