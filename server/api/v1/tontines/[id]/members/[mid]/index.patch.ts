import { getRouterParam, readBody } from 'h3'
import { and, eq } from 'drizzle-orm'
import { memberUpdateInput } from '../../../../../../../shared/schemas/index.ts'
import { useDb } from '../../../../../../db/index.ts'
import { memberships, tontines } from '../../../../../../db/schema.ts'
import { attribuerParts, definirRole } from '../../../../../../services/membres.ts'
import { requireMembership } from '../../../../../../utils/auth.ts'
import { apiError, validationError } from '../../../../../../utils/errors.ts'

/** Change le rôle ou le nombre de parts d'un membre. */
export default defineEventHandler(async (event) => {
  const tontineId = getRouterParam(event, 'id')
  const membershipId = getRouterParam(event, 'mid')
  if (!tontineId || !membershipId) throw apiError('NOT_FOUND', 'Membre introuvable.')

  await requireMembership(event, tontineId, ['president'])

  const parsed = memberUpdateInput.safeParse(await readBody(event))
  if (!parsed.success) throw validationError(parsed.error)

  const db = useDb()
  const [membre] = db
    .select()
    .from(memberships)
    .where(and(eq(memberships.id, membershipId), eq(memberships.tontineId, tontineId)))
    .limit(1)
    .all()

  if (!membre) throw apiError('NOT_FOUND', 'Membre introuvable.')

  if (parsed.data.role) definirRole(db, membershipId, parsed.data.role)

  if (parsed.data.shares !== undefined) {
    const [tontine] = db.select().from(tontines).where(eq(tontines.id, tontineId)).limit(1).all()

    // Changer le nombre de parts en cours de cycle modifierait le pot attendu
    // de tours déjà cotisés : les dus deviendraient faux rétroactivement.
    if (tontine?.status === 'running') {
      throw apiError(
        'FORBIDDEN',
        'Le nombre de parts ne peut plus changer une fois la tontine lancée.',
        { field: 'shares' },
      )
    }
    attribuerParts(db, tontineId, membershipId, parsed.data.shares)
  }

  return { ok: true }
})
