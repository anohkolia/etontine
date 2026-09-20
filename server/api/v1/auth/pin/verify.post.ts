import { readBody } from 'h3'
import { z } from 'zod'
import { codeSaisi } from '../../../../../shared/schemas/index.ts'
import { useDb } from '../../../../db/index.ts'
import { requireUser } from '../../../../utils/auth.ts'
import { validationError } from '../../../../utils/errors.ts'
import { verifierCodeAcces } from '../../../../services/connexion.ts'

/**
 * Vérifie le code d'accès pour l'écran de verrouillage.
 *
 * Les compteurs sont ceux de la connexion : cinq échecs bloquent, dix
 * verrouillent le compte. Quelqu'un qui devine le code sur un téléphone
 * prêté n'a pas plus d'essais que depuis Internet. La sortie de secours est
 * « code oublié », par e-mail.
 */
const input = z.object({ code: codeSaisi })

export default defineEventHandler(async (event) => {
  const user = requireUser(event)
  const parsed = input.safeParse(await readBody(event))
  if (!parsed.success) throw validationError(parsed.error)

  await verifierCodeAcces(useDb(), user, parsed.data.code)
  return { ok: true }
})
