import { readBody } from 'h3'
import { eq, inArray } from 'drizzle-orm'
import { bulkConfirmInput } from '../../../../shared/schemas/index.ts'
import { useDb } from '../../../db/index.ts'
import { contributions, paymentDeclarations, rounds } from '../../../db/schema.ts'
import { confirmerEnLot } from '../../../services/confirmations.ts'
import { requireMembership } from '../../../utils/auth.ts'
import { apiError, validationError } from '../../../utils/errors.ts'
import { withIdempotency } from '../../../utils/idempotency.ts'

/**
 * « Tout confirmer ». Idempotent : une déclaration déjà décidée est passée.
 *
 * Toutes les déclarations doivent appartenir à la **même** tontine : sans cette
 * vérification, une liste d'identifiants pourrait faire confirmer des
 * déclarations d'une tontine où l'appelant n'a aucun rôle.
 */
export default defineEventHandler(async (event) => {
  const parsed = bulkConfirmInput.safeParse(await readBody(event))
  if (!parsed.success) throw validationError(parsed.error)

  const db = useDb()
  const tontines = new Set(
    db.select({ tontineId: rounds.tontineId })
      .from(paymentDeclarations)
      .innerJoin(contributions, eq(contributions.id, paymentDeclarations.contributionId))
      .innerJoin(rounds, eq(rounds.id, contributions.roundId))
      .where(inArray(paymentDeclarations.id, parsed.data.ids))
      .all()
      .map(l => l.tontineId),
  )

  if (tontines.size !== 1) {
    throw apiError(
      'VALIDATION_ERROR',
      'Les déclarations doivent appartenir à une seule tontine.',
      { field: 'ids' },
    )
  }

  const tontineId = [...tontines][0]!
  const { user } = await requireMembership(event, tontineId, ['treasurer', 'president'])

  return withIdempotency(event, user.id, parsed.data, () =>
    confirmerEnLot(db, parsed.data.ids, user.id))
})
