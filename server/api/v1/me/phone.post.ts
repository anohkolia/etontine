import { readBody } from 'h3'
import { phoneChangeInput } from '../../../../shared/schemas/index.ts'
import { useDb } from '../../../db/index.ts'
import { appliquerChangementNumero } from '../../../services/compte.ts'
import { verifierCodeAcces } from '../../../services/connexion.ts'
import { requireUser } from '../../../utils/auth.ts'
import { validationError } from '../../../utils/errors.ts'

/**
 * Change le numéro du compte, contre le code d'accès.
 *
 * Le numéro est l'identifiant de connexion et c'est aussi là que le pot
 * arrive : la session seule ne suffit pas. Pose `phone_changed_at` — les
 * versements vers ce membre sont gelés quarante-huit heures, son bureau est
 * prévenu — et l'adresse du compte reçoit un avis.
 */
export default defineEventHandler(async (event) => {
  const user = requireUser(event)
  const parsed = phoneChangeInput.safeParse(await readBody(event))
  if (!parsed.success) throw validationError(parsed.error)

  const db = useDb()
  await verifierCodeAcces(db, user, parsed.data.code)
  await appliquerChangementNumero(db, user.id, parsed.data.phone)
  return { ok: true, phone: parsed.data.phone }
})
