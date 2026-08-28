import { getRouterParam, readBody } from 'h3'
import { eq } from 'drizzle-orm'
import { disputeInput } from '../../../../../shared/schemas/index.ts'
import { useDb } from '../../../../db/index.ts'
import { ledgerEntries } from '../../../../db/schema.ts'
import { ouvrirContestation } from '../../../../services/litiges.ts'
import { requireMembership } from '../../../../utils/auth.ts'
import { apiError, validationError } from '../../../../utils/errors.ts'

/**
 * « Signaler une erreur » sur une écriture du registre.
 *
 * Ouvert à **tout membre actif** : c'est la soupape du système. Le registre
 * étant append-only, la seule façon de dire « ce n'est pas ce qui s'est passé »
 * est de l'écrire à côté, et que tout le monde le voie.
 */
export default defineEventHandler(async (event) => {
  const entryId = getRouterParam(event, 'entryId')
  if (!entryId) throw apiError('NOT_FOUND', 'Écriture introuvable.')

  const db = useDb()
  const [ecriture] = db.select({ tontineId: ledgerEntries.tontineId }).from(ledgerEntries)
    .where(eq(ledgerEntries.id, entryId)).limit(1).all()

  if (!ecriture) throw apiError('NOT_FOUND', 'Écriture introuvable.')

  const { user } = await requireMembership(event, ecriture.tontineId)

  const parsed = disputeInput.safeParse(await readBody(event))
  if (!parsed.success) throw validationError(parsed.error)

  return ouvrirContestation(db, entryId, user.id, parsed.data.message)
})
