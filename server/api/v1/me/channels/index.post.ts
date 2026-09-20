import { readBody } from 'h3'
import { collectionChannelInput } from '../../../../../shared/schemas/index.ts'
import { useDb } from '../../../../db/index.ts'
import { creerCanal } from '../../../../services/canaux.ts'
import { verifierCodeAcces } from '../../../../services/connexion.ts'
import { requireUser } from '../../../../utils/auth.ts'
import { validationError } from '../../../../utils/errors.ts'

/**
 * Crée un canal de collecte, contre le code d'accès.
 *
 * C'est le numéro où les cotisations vont partir : une session ouverte sur
 * un téléphone prêté ne doit pas suffire à en déclarer un.
 */
export default defineEventHandler(async (event) => {
  const user = requireUser(event)
  const parsed = collectionChannelInput.safeParse(await readBody(event))
  if (!parsed.success) throw validationError(parsed.error)

  const db = useDb()
  await verifierCodeAcces(db, user, parsed.data.code)

  const { code: _code, ...canal } = parsed.data
  const id = await creerCanal(db, user.id, canal)
  return { id }
})
