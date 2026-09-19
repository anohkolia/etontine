import { readBody } from 'h3'
import { z } from 'zod'
import { requireUser } from '../../../../utils/auth.ts'
import { validationError } from '../../../../utils/errors.ts'
import { verifierCodeVerrou } from '../../../../services/verrou.ts'

/**
 * Vérifie le code de verrouillage de l'écran.
 *
 * Le code se posait et se retirait, mais **rien ne le demandait jamais** : la
 * fonctionnalité était un réglage sans effet. Cinq échecs bloquent quinze
 * minutes ; la sortie de secours est la reconnexion par SMS.
 */
const input = z.object({ pin: z.string().regex(/^\d{4,6}$/, 'Le code contient 4 à 6 chiffres') })

export default defineEventHandler(async (event) => {
  const user = requireUser(event)
  const parsed = input.safeParse(await readBody(event))
  if (!parsed.success) throw validationError(parsed.error)

  return verifierCodeVerrou(user, parsed.data.pin)
})
