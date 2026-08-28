import { getRouterParam, readBody } from 'h3'
import { eq } from 'drizzle-orm'
import { penaltyInput } from '../../../../../shared/schemas/index.ts'
import { useDb } from '../../../../db/index.ts'
import { contributions, rounds } from '../../../../db/schema.ts'
import { appliquerAmende } from '../../../../services/amendes.ts'
import { requireMembership } from '../../../../utils/auth.ts'
import { apiError, validationError } from '../../../../utils/errors.ts'

/**
 * Applique une amende. **Président uniquement, et jamais automatiquement.**
 *
 * Le calcul est fait par la machine, la décision par le président : une amende
 * qui tombe toute seule sur quelqu'un dont la moto est en panne, c'est la
 * tontine qui perd un membre.
 */
export default defineEventHandler(async (event) => {
  const contributionId = getRouterParam(event, 'id')
  if (!contributionId) throw apiError('NOT_FOUND', 'Cotisation introuvable.')

  const db = useDb()
  const [ligne] = db
    .select({ tontineId: rounds.tontineId })
    .from(contributions)
    .innerJoin(rounds, eq(rounds.id, contributions.roundId))
    .where(eq(contributions.id, contributionId))
    .limit(1)
    .all()

  if (!ligne) throw apiError('NOT_FOUND', 'Cotisation introuvable.')

  const { user } = await requireMembership(event, ligne.tontineId, ['president'])

  const parsed = penaltyInput.safeParse(await readBody(event))
  if (!parsed.success) throw validationError(parsed.error)

  return appliquerAmende(db, contributionId, user.id, parsed.data.amount, parsed.data.reason)
})
