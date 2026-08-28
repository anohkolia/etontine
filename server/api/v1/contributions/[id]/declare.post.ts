import { getRouterParam, readBody } from 'h3'
import { eq } from 'drizzle-orm'
import { declareContributionInput } from '../../../../../shared/schemas/index.ts'
import { useDb } from '../../../../db/index.ts'
import { contributions, rounds } from '../../../../db/schema.ts'
import { declarerPaiement } from '../../../../services/declarations.ts'
import { requireMembership } from '../../../../utils/auth.ts'
import { apiError, validationError } from '../../../../utils/errors.ts'
import { withIdempotency } from '../../../../utils/idempotency.ts'

/**
 * Déclare un paiement. **Idempotence obligatoire** (règle 4).
 *
 * Le client envoie une intention — « j'ai envoyé tel montant » — et le serveur
 * décide de l'état. Un client qui posterait `status: "confirmed"` n'obtiendrait
 * rien : ce champ n'existe pas dans l'entrée.
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

  const { user, membership } = await requireMembership(event, ligne.tontineId)

  // On ne déclare que pour soi. Déclarer pour un tiers passe par
  // `declare-cash`, réservé au trésorier et tracé comme tel.
  if (ligne.membershipId !== membership.id) {
    throw apiError(
      'FORBIDDEN',
      'Cette cotisation n’est pas la tienne. Le trésorier peut enregistrer un versement en espèces pour un autre membre.',
    )
  }

  const parsed = declareContributionInput.safeParse(await readBody(event))
  if (!parsed.success) throw validationError(parsed.error)

  return withIdempotency(event, user.id, parsed.data, () =>
    declarerPaiement(db, contributionId, user.id, parsed.data))
})
