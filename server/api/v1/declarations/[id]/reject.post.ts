import { getRouterParam, readBody } from 'h3'
import { eq } from 'drizzle-orm'
import { rejectDeclarationInput } from '../../../../../shared/schemas/index.ts'
import { useDb } from '../../../../db/index.ts'
import { contributions, paymentDeclarations, rounds } from '../../../../db/schema.ts'
import { rejeterDeclaration } from '../../../../services/confirmations.ts'
import { requireMembership } from '../../../../utils/auth.ts'
import { apiError, validationError } from '../../../../utils/errors.ts'

/**
 * Rejette une déclaration. Le motif est obligatoire, validé par Zod.
 *
 * Le bureau rejette ce qu'il ne retrouve pas. **Et le membre rejette ce qu'on a
 * enregistré à sa place** : `docs/data-model.md` §2.4 prévoit explicitement
 * « membre (si déclaré par le trésorier) », et c'est la contrepartie de la
 * déclaration d'espèces. Sans ce droit, le bureau pouvait porter au registre un
 * versement qui n'a jamais eu lieu, et l'intéressé n'avait aucun moyen de dire
 * le contraire.
 */
export default defineEventHandler(async (event) => {
  const declarationId = getRouterParam(event, 'id')
  if (!declarationId) throw apiError('NOT_FOUND', 'Déclaration introuvable.')

  const db = useDb()
  const [ligne] = db
    .select({
      tontineId: rounds.tontineId,
      membershipId: contributions.membershipId,
      source: paymentDeclarations.source,
    })
    .from(paymentDeclarations)
    .innerJoin(contributions, eq(contributions.id, paymentDeclarations.contributionId))
    .innerJoin(rounds, eq(rounds.id, contributions.roundId))
    .where(eq(paymentDeclarations.id, declarationId))
    .limit(1)
    .all()

  if (!ligne) throw apiError('NOT_FOUND', 'Déclaration introuvable.')

  const { user, membership } = await requireMembership(event, ligne.tontineId)

  const duBureau = membership.role === 'treasurer' || membership.role === 'president'
  const sienneEtEnregistreePourLui = ligne.source === 'treasurer'
    && ligne.membershipId === membership.id

  if (!duBureau && !sienneEtEnregistreePourLui) {
    throw apiError(
      'FORBIDDEN',
      'Cette action est réservée au bureau, ou au membre pour qui le versement a été enregistré.',
    )
  }

  const parsed = rejectDeclarationInput.safeParse(await readBody(event))
  if (!parsed.success) throw validationError(parsed.error)

  return rejeterDeclaration(db, declarationId, user.id, parsed.data.reason)
})
