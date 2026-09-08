import { getRouterParam } from 'h3'
import { eq } from 'drizzle-orm'
import { useDb } from '../../../../db/index.ts'
import { contributions, rounds } from '../../../../db/schema.ts'
import { rouvrirCotisation } from '../../../../services/confirmations.ts'
import { requireMembership } from '../../../../utils/auth.ts'
import { apiError } from '../../../../utils/errors.ts'

/**
 * Rouvre une cotisation contestée — président ou censeur (§2.4).
 *
 * Sans elle, un rejet était sans retour : `disputed` ne mène qu'à `confirmed`
 * ou `due`, re-déclarer depuis `disputed` est refusé par la machine à états, et
 * rien n'empruntait le chemin du retour. Le motif du rejet demandait de
 * corriger quelque chose qu'on ne pouvait plus renvoyer.
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

  const { user } = await requireMembership(event, ligne.tontineId, ['president', 'auditor'])
  return rouvrirCotisation(db, contributionId, user.id)
})
