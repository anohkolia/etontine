import { getRouterParam } from 'h3'
import { eq } from 'drizzle-orm'
import { useDb } from '../../../../db/index.ts'
import { advances, rounds } from '../../../../db/schema.ts'
import { solderAvance } from '../../../../services/avances.ts'
import { requireMembership } from '../../../../utils/auth.ts'
import { apiError } from '../../../../utils/errors.ts'

/**
 * Solde une avance : la dette entre les deux membres est réglée.
 *
 * `solderAvance` existait sans route, et l'écran affichait « soldée » sans que
 * rien ne puisse le devenir. Une reconnaissance de dette qu'on ne peut jamais
 * éteindre est pire que pas de reconnaissance du tout : elle reste affichée
 * après le remboursement, et c'est elle qui déclenche la dispute suivante.
 */
export default defineEventHandler(async (event) => {
  const avanceId = getRouterParam(event, 'id')
  if (!avanceId) throw apiError('NOT_FOUND', 'Avance introuvable.')

  const db = useDb()
  const [ligne] = db
    .select({ tontineId: rounds.tontineId })
    .from(advances)
    .innerJoin(rounds, eq(rounds.id, advances.roundId))
    .where(eq(advances.id, avanceId))
    .limit(1)
    .all()

  if (!ligne) throw apiError('NOT_FOUND', 'Avance introuvable.')

  await requireMembership(event, ligne.tontineId, ['treasurer', 'president'])
  return solderAvance(db, avanceId)
})
