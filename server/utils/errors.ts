import { createError } from 'h3'
import type { H3Error } from 'h3'
import type { z } from 'zod'
import type { apiErrorCode } from '../../shared/schemas/index.ts'

export type ApiErrorCode = z.infer<typeof apiErrorCode>

/**
 * Correspondance code métier → statut HTTP, telle que fixée par
 * docs/api-contract.md. C'est la **seule** table : aucun point d'entrée ne
 * choisit son statut à la main.
 */
export const ERROR_STATUS: Record<ApiErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 422,
  INVALID_TRANSITION: 409,
  IDEMPOTENCY_CONFLICT: 409,
  KYC_REQUIRED: 403,
  RATE_LIMITED: 429,
  // 403 et non 402 : rien n'est dû à l'application, et le quota se lève aussi
  // en fermant une tontine, pas seulement en payant.
  PLAN_LIMIT: 403,
}

export interface ApiErrorDetails {
  /** Le champ fautif, quand l'erreur en désigne un. */
  field?: string
  /** Palier KYC exigé — uniquement pour `KYC_REQUIRED`. */
  requiredLevel?: number
}

/**
 * Construit une erreur au **format unique** de l'API :
 * `{ error: { code, message, field?, requiredLevel? } }`.
 *
 * Le message est destiné à être lu par un membre : en français, sans jargon
 * technique, et **sans jamais mentionner de montant** (règle 21 — l'erreur peut
 * finir dans un journal ou une notification).
 */
export function apiError(
  code: ApiErrorCode,
  message: string,
  details: ApiErrorDetails = {},
): H3Error {
  return createError({
    statusCode: ERROR_STATUS[code],
    statusMessage: code,
    data: {
      error: {
        code,
        message,
        ...(details.field ? { field: details.field } : {}),
        ...(details.requiredLevel !== undefined ? { requiredLevel: details.requiredLevel } : {}),
      },
    },
  })
}

/** Traduit une erreur de validation Zod vers le format unique. */
export function validationError(error: z.ZodError): H3Error {
  const premier = error.issues[0]
  return apiError(
    'VALIDATION_ERROR',
    premier?.message ?? 'Données invalides',
    { field: premier?.path.join('.') || undefined },
  )
}
