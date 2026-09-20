import { getRequestIP, readBody } from 'h3'
import { registerInput } from '../../../../shared/schemas/index.ts'
import { useDb } from '../../../db/index.ts'
import { inscrire, limiterParIp } from '../../../services/connexion.ts'
import { validationError } from '../../../utils/errors.ts'

/**
 * Inscription : numéro, e-mail, code d'accès. Un lien de confirmation part
 * par e-mail ; le compte ne s'ouvre qu'au clic.
 *
 * Renvoie **toujours** la même chose, que le numéro ou l'adresse soient déjà
 * pris ou non (acceptation T07) : une réponse différenciée ferait de ce point
 * d'entrée un annuaire des membres.
 */
export default defineEventHandler(async (event) => {
  limiterParIp(getRequestIP(event, { xForwardedFor: true }))

  const parsed = registerInput.safeParse(await readBody(event))
  if (!parsed.success) throw validationError(parsed.error)

  return await inscrire(useDb(), parsed.data)
})
