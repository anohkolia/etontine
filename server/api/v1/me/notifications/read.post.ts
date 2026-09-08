import { readBody } from 'h3'
import { z } from 'zod'
import { useDb } from '../../../../db/index.ts'
import { marquerLues } from '../../../../services/notifications.ts'
import { requireUser } from '../../../../utils/auth.ts'
import { validationError } from '../../../../utils/errors.ts'

const lectureInput = z.object({ ids: z.array(z.string().uuid()).optional() })

/** Marque des notifications comme lues — toutes si aucun identifiant n'est donné. */
export default defineEventHandler(async (event) => {
  const user = requireUser(event)

  const parsed = lectureInput.safeParse((await readBody(event)) ?? {})
  if (!parsed.success) throw validationError(parsed.error)

  return { lues: marquerLues(useDb(), user.id, parsed.data.ids) }
})
