import { readBody } from 'h3'
import { collectionChannelInput } from '../../../../../shared/schemas/index.ts'
import { useDb } from '../../../../db/index.ts'
import { creerCanal } from '../../../../services/canaux.ts'
import { requireUser } from '../../../../utils/auth.ts'
import { validationError } from '../../../../utils/errors.ts'

/** Crée un canal de collecte. Il naît **non vérifié**, donc inutilisable. */
export default defineEventHandler(async (event) => {
  const user = requireUser(event)
  const parsed = collectionChannelInput.safeParse(await readBody(event))
  if (!parsed.success) throw validationError(parsed.error)

  const id = creerCanal(useDb(), user.id, parsed.data)
  return { id, verified: false }
})
