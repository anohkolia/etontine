import { getRouterParam } from 'h3'
import { useDb } from '../../../../../db/index.ts'
import { membresDe, rotationDe } from '../../../../../services/membres.ts'
import { requireMembership } from '../../../../../utils/auth.ts'
import { apiError } from '../../../../../utils/errors.ts'

/**
 * Membres, parts et positions de rotation. Lisible par tout membre actif.
 *
 * Les numéros de téléphone, eux, ne le sont pas : le bureau en a besoin pour
 * relancer et pour rattacher, les autres membres non. La liste exposait tous
 * les numéros à tout le monde — un annuaire du groupe, offert à quiconque
 * rejoint par un lien qui a circulé. Chacun voit le sien, le bureau voit tout.
 */
export default defineEventHandler(async (event) => {
  const tontineId = getRouterParam(event, 'id')
  if (!tontineId) throw apiError('NOT_FOUND', 'Tontine introuvable.')

  const { membership } = await requireMembership(event, tontineId)
  const db = useDb()

  const bureau = membership.role === 'president' || membership.role === 'treasurer'
  const members = (await membresDe(db, tontineId)).map(m =>
    bureau || m.id === membership.id ? m : { ...m, phone: null },
  )

  return { members, rotation: await rotationDe(db, tontineId) }
})
