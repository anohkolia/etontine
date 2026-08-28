import { getRouterParam } from 'h3'
import { eq } from 'drizzle-orm'
import { useDb } from '../../../../db/index.ts'
import { tontines } from '../../../../db/schema.ts'
import { canauxDeTontine } from '../../../../services/canaux.ts'
import {
  blocagesPublication, membresActifs, potAttendu, totalParts, tourCourant,
} from '../../../../services/tontines.ts'
import { requireMembership } from '../../../../utils/auth.ts'
import { apiError } from '../../../../utils/errors.ts'

/** Détail d'une tontine : réglages, progression, tour courant. */
export default defineEventHandler(async (event) => {
  const tontineId = getRouterParam(event, 'id')
  if (!tontineId) throw apiError('NOT_FOUND', 'Tontine introuvable.')

  const { membership } = await requireMembership(event, tontineId)

  const db = useDb()
  const [tontine] = db.select().from(tontines).where(eq(tontines.id, tontineId)).limit(1).all()
  if (!tontine) throw apiError('NOT_FOUND', 'Tontine introuvable.')

  return {
    ...tontine,
    myRole: membership.role,
    totalShares: totalParts(db, tontineId),
    activeMembers: membresActifs(db, tontineId),
    // Tous les montants sont calculés côté serveur (règle 2). Le client affiche.
    expectedPot: potAttendu(db, tontineId),
    channels: canauxDeTontine(db, tontineId),
    currentRound: tourCourant(db, tontineId),
    publicationBlockers: tontine.status === 'draft' ? blocagesPublication(db, tontineId) : [],
  }
})
