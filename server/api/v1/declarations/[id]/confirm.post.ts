import { getRouterParam } from 'h3'
import { eq } from 'drizzle-orm'
import { useDb } from '../../../../db/index.ts'
import { contributions, paymentDeclarations, rounds } from '../../../../db/schema.ts'
import { confirmerDeclaration } from '../../../../services/confirmations.ts'
import { requireMembership } from '../../../../utils/auth.ts'
import { apiError } from '../../../../utils/errors.ts'
import { withIdempotency } from '../../../../utils/idempotency.ts'

/** Confirme une déclaration. Refusé si l'appelant en est l'auteur. */
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

  return withIdempotency(event, user.id, { declarationId }, () =>
    confirmerDeclaration(db, declarationId, user.id))
})
