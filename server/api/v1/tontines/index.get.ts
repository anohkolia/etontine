import { useDb } from '../../../db/index.ts'
import { mesTontines } from '../../../services/tontines.ts'
import { requireUser } from '../../../utils/auth.ts'

/** Mes tontines, avec mon rôle. Un seul appel doit suffire au tableau de bord. */
export default defineEventHandler((event) => {
  const user = requireUser(event)
  return mesTontines(useDb(), user.id)
})
