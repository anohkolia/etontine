import { getRouterParam } from 'h3'
import { useDb } from '../../../../db/index.ts'
import { reconnaitreVersement } from '../../../../services/escalade.ts'
import { requireUser } from '../../../../utils/auth.ts'
import { apiError } from '../../../../utils/errors.ts'

/**
 * Confirmation inverse : le membre reconnaît un versement enregistré pour lui.
 *
 * Contrepartie de la déclaration d'espèces par le trésorier. Sans elle, le
 * bureau pourrait porter au registre des versements qui n'ont jamais eu lieu.
 */
export default defineEventHandler((event) => {
  const declarationId = getRouterParam(event, 'id')
  if (!declarationId) throw apiError('NOT_FOUND', 'Déclaration introuvable.')

  const user = requireUser(event)
  const resultat = reconnaitreVersement(useDb(), declarationId, user.id)

  if (!resultat.ok) {
    throw resultat.raison === 'introuvable'
      ? apiError('NOT_FOUND', 'Déclaration introuvable.')
      : apiError('FORBIDDEN', 'Ce versement n’a pas été enregistré à ton nom.')
  }

  return { ok: true }
})
