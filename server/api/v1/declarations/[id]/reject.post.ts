import { getRouterParam, readBody } from 'h3'
import { eq } from 'drizzle-orm'
import { rejectDeclarationInput } from '../../../../../shared/schemas/index.ts'
import { useDb } from '../../../../db/index.ts'
import { contributions, paymentDeclarations, rounds } from '../../../../db/schema.ts'
import { rejeterDeclaration } from '../../../../services/confirmations.ts'
import { requireMembership } from '../../../../utils/auth.ts'
import { apiError, validationError } from '../../../../utils/errors.ts'

/** Rejette une déclaration. Le motif est obligatoire, validé par Zod. */
export default defineEventHandler(async (event) => {
  const declarationId = getRouterParam(event, 'id')
  if (!declarationId) throw apiError('NOT_FOUND', 'Déclaration introuvable.')

  const db = useDb()
  const [ligne] = db
    .select({ tontineId: rounds.tontineId })
    .from(paymentDeclarations)
    .innerJoin(contributions, eq(contributions.id, paymentDeclarations.contributionId))
    .innerJoin(rounds, eq(rounds.id, contributions.roundId))
    .where(eq(paymentDeclarations.id, declarationId))
    .limit(1)
    .all()

  if (!ligne) throw apiError('NOT_FOUND', 'Déclaration introuvable.')

  const { user } = await requireMembership(event, ligne.tontineId, ['treasurer', 'president'])

  const parsed = rejectDeclarationInput.safeParse(await readBody(event))
  if (!parsed.success) throw validationError(parsed.error)

  return rejeterDeclaration(db, declarationId, user.id, parsed.data.reason)
})
