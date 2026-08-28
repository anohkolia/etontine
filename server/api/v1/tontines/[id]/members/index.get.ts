import { getRouterParam } from 'h3'
import { useDb } from '../../../../../db/index.ts'
import { membresDe, rotationDe } from '../../../../../services/membres.ts'
import { requireMembership } from '../../../../../utils/auth.ts'
import { apiError } from '../../../../../utils/errors.ts'

/** Membres, parts et positions de rotation. Lisible par tout membre actif. */
export default defineEventHandler(async (event) => {
  const tontineId = getRouterParam(event, 'id')
  if (!tontineId) throw apiError('NOT_FOUND', 'Tontine introuvable.')

  await requireMembership(event, tontineId)
  const db = useDb()

  return { members: membresDe(db, tontineId), rotation: rotationDe(db, tontineId) }
})
