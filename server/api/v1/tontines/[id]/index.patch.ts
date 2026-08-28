import { getRouterParam, readBody } from 'h3'
import { z } from 'zod'
import {
  amountFcfa, frequency, feesBearer, rotationMode, tontineAccess,
} from '../../../../../shared/schemas/index.ts'
import { useDb } from '../../../../db/index.ts'
import { definirCanaux, majTontine } from '../../../../services/tontines.ts'
import { requireMembership } from '../../../../utils/auth.ts'
import { apiError, validationError } from '../../../../utils/errors.ts'

/**
 * Met à jour un brouillon, étape par étape.
 *
 * Chaque étape du wizard envoie ce qu'elle vient de saisir : le brouillon est
 * ainsi enregistré au fil de l'eau, et fermer l'application ne perd rien.
 */
const patchInput = z.object({
  name: z.string().trim().min(3).max(60).optional(),
  description: z.string().trim().max(500).nullish(),
  locality: z.string().trim().max(80).nullish(),
  access: tontineAccess.optional(),
  shareAmount: amountFcfa.optional(),
  frequency: frequency.optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  rotationMode: rotationMode.optional(),
  feesBearer: feesBearer.optional(),
  penaltyAmount: z.number().int().min(0).optional(),
  penaltyPeriod: z.enum(['once', 'per_day']).optional(),
  penaltyCap: amountFcfa.nullish(),
  graceDays: z.number().int().min(0).max(30).optional(),
  counterValidationThreshold: amountFcfa.optional(),
  collectionChannelIds: z.array(z.string().uuid()).optional(),
})

export default defineEventHandler(async (event) => {
  const tontineId = getRouterParam(event, 'id')
  if (!tontineId) throw apiError('NOT_FOUND', 'Tontine introuvable.')

  const { user } = await requireMembership(event, tontineId, ['president'])

  const parsed = patchInput.safeParse(await readBody(event))
  if (!parsed.success) throw validationError(parsed.error)

  const { collectionChannelIds, ...champs } = parsed.data
  const db = useDb()

  if (Object.keys(champs).length > 0) majTontine(db, tontineId, champs)
  if (collectionChannelIds) definirCanaux(db, tontineId, collectionChannelIds, user.id)

  return { ok: true }
})
