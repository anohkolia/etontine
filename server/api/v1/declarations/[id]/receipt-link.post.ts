import { getRouterParam } from 'h3'
import { eq } from 'drizzle-orm'
import { useDb } from '../../../../db/index.ts'
import { contributions, paymentDeclarations, rounds } from '../../../../db/schema.ts'
import { lienRecu } from '../../../../services/recus.ts'
import { requireMembership } from '../../../../utils/auth.ts'
import { apiError } from '../../../../utils/errors.ts'

/** Fabrique un lien de reçu signé. Réservé aux membres de la tontine. */
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

  await requireMembership(event, ligne.tontineId)

  const base = process.env.NUXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
  return lienRecu(declarationId, base)
})
