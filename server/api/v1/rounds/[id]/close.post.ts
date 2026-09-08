import { getRouterParam, readBody } from 'h3'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { useDb } from '../../../../db/index.ts'
import { rounds } from '../../../../db/schema.ts'
import { cloturerTourSansAccuse } from '../../../../services/versements.ts'
import { requireMembership } from '../../../../utils/auth.ts'
import { apiError, validationError } from '../../../../utils/errors.ts'

const closeInput = z.object({ reason: z.string().trim().min(5).max(300) })

/**
 * Clôture forcée d'un tour — président, cas exceptionnel.
 *
 * La voie normale reste l'accusé de réception du bénéficiaire, et lui seul
 * peut le poser. Cette route existe pour le cas où il ne le *peut* pas : un
 * membre géré n'a pas de compte, donc pas de bouton. Sans elle, la tontine se
 * fige au premier bénéficiaire sans application.
 *
 * Le motif est obligatoire et part au registre : une clôture sans accusé doit
 * rester lisible des années plus tard, avec sa raison et son auteur.
 */
export default defineEventHandler(async (event) => {
  const roundId = getRouterParam(event, 'id')
  if (!roundId) throw apiError('NOT_FOUND', 'Tour introuvable.')

  const db = useDb()
  const [tour] = db.select({ tontineId: rounds.tontineId }).from(rounds).where(eq(rounds.id, roundId)).limit(1).all()
  if (!tour) throw apiError('NOT_FOUND', 'Tour introuvable.')

  const { user } = await requireMembership(event, tour.tontineId, ['president'])

  const parsed = closeInput.safeParse(await readBody(event))
  if (!parsed.success) throw validationError(parsed.error)

  return cloturerTourSansAccuse(db, roundId, user.id, parsed.data.reason)
})
