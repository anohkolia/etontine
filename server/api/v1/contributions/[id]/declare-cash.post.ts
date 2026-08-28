import { getRouterParam, readBody } from 'h3'
import { eq } from 'drizzle-orm'
import { declareCashInput } from '../../../../../shared/schemas/index.ts'
import { useDb } from '../../../../db/index.ts'
import { contributions, rounds } from '../../../../db/schema.ts'
import { declarerEspeces } from '../../../../services/declarations.ts'
import { requireMembership } from '../../../../utils/auth.ts'
import { apiError, validationError } from '../../../../utils/errors.ts'
import { withIdempotency } from '../../../../utils/idempotency.ts'

/**
 * Déclaration d'espèces par le trésorier, pour un autre membre.
 *
 * Cas très fréquent : le membre paie de la main à la main. Le membre concerné
 * reçoit une demande de confirmation — c'est la contrepartie de cette
 * dissymétrie.
 */
export default defineEventHandler(async (event) => {
  const contributionId = getRouterParam(event, 'id')
  if (!contributionId) throw apiError('NOT_FOUND', 'Cotisation introuvable.')

  const db = useDb()
  const [ligne] = db
    .select({ tontineId: rounds.tontineId, membershipId: contributions.membershipId })
    .from(contributions)
    .innerJoin(rounds, eq(rounds.id, contributions.roundId))
    .where(eq(contributions.id, contributionId))
    .limit(1)
    .all()

  if (!ligne) throw apiError('NOT_FOUND', 'Cotisation introuvable.')

  const { user } = await requireMembership(event, ligne.tontineId, ['treasurer', 'president'])

  const parsed = declareCashInput.safeParse(await readBody(event))
  if (!parsed.success) throw validationError(parsed.error)

  if (parsed.data.membershipId !== ligne.membershipId) {
    throw apiError(
      'VALIDATION_ERROR',
      'Le membre indiqué ne correspond pas à cette cotisation.',
      { field: 'membershipId' },
    )
  }

  return withIdempotency(event, user.id, parsed.data, () =>
    declarerEspeces(db, contributionId, user.id, parsed.data))
})
