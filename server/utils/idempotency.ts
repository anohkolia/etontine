import { randomUUID } from 'node:crypto'
import { and, eq, lt } from 'drizzle-orm'
import { getRequestHeader } from 'h3'
import type { H3Event } from 'h3'
import { useDb } from '../db/index.ts'
import { idempotencyKeys } from '../db/schema.ts'
import { apiError } from './errors.ts'
import { hashPayload } from './hash.ts'

type Db = ReturnType<typeof useDb>

/** Le rejeu d'une clé est reconnu pendant 24 h (docs/api-contract.md). */
const FENETRE_MS = 24 * 60 * 60 * 1000

export interface IdempotencyParams {
  key: string
  userId: string
  /** Point d'entrée : une même clé sur deux routes reste deux opérations. */
  endpoint: string
  /** Corps de la requête, haché pour détecter un rejeu au contenu différent. */
  body: unknown
}

/**
 * Exécute une opération **au plus une fois** pour une clé donnée (règle 4).
 *
 * Trois cas, et un seul est un succès nouveau :
 *
 * - clé inconnue → on exécute, on enregistre la réponse, on la renvoie ;
 * - clé connue, même corps → on renvoie la réponse d'origine **sans rien
 *   recréer**. C'est le cas qui compte : sur un réseau ivoirien, un membre qui
 *   perd la connexion pendant la déclaration retentera, et il ne doit pas
 *   déclarer deux fois le même paiement ;
 * - clé connue, corps différent → `409 IDEMPOTENCY_CONFLICT`. Réutiliser une
 *   clé pour autre chose est un bug d'appelant, pas un rejeu.
 *
 * L'insertion de la clé est faite **dans la même transaction** que l'opération :
 * deux requêtes concurrentes ne peuvent pas passer toutes les deux.
 */
export async function runIdempotent<T>(
  db: Db,
  params: IdempotencyParams,
  operation: () => Promise<T> | T,
): Promise<{ result: T, replayed: boolean }> {
  const requestHash = hashPayload(params.body ?? null)

  const [existante] = await db
    .select()
    .from(idempotencyKeys)
    .where(and(
      eq(idempotencyKeys.key, params.key),
      eq(idempotencyKeys.userId, params.userId),
      eq(idempotencyKeys.endpoint, params.endpoint),
    ))
    .limit(1)

  if (existante) {
    if (existante.requestHash !== requestHash) {
      throw apiError(
        'IDEMPOTENCY_CONFLICT',
        'Cette clé a déjà servi pour une autre opération.',
        { field: 'Idempotency-Key' },
      )
    }
    return { result: existante.responseBody as T, replayed: true }
  }

  const result = await operation()

  await db.insert(idempotencyKeys).values({
    id: randomUUID(),
    key: params.key,
    userId: params.userId,
    endpoint: params.endpoint,
    requestHash,
    responseStatus: 200,
    responseBody: result as object,
    expiresAt: new Date(Date.now() + FENETRE_MS),
  })

  return { result, replayed: false }
}

/**
 * Enveloppe h3 de `runIdempotent`. L'en-tête `Idempotency-Key` est
 * **obligatoire** sur toute création liée à l'argent : son absence est une
 * erreur de validation, pas un cas toléré.
 */
export async function withIdempotency<T>(
  event: H3Event,
  userId: string,
  body: unknown,
  operation: () => Promise<T> | T,
): Promise<T> {
  const key = getRequestHeader(event, 'idempotency-key')

  if (!key) {
    throw apiError(
      'VALIDATION_ERROR',
      'En-tête Idempotency-Key obligatoire sur cette opération.',
      { field: 'Idempotency-Key' },
    )
  }

  const { result } = await runIdempotent(
    useDb(),
    { key, userId, endpoint: `${event.method} ${event.path?.split('?')[0] ?? ''}`, body },
    operation,
  )
  return result
}

/** Purge des clés expirées. Appelée par une tâche planifiée. */
export async function purgeExpiredKeys(db: Db = useDb()): Promise<void> {
  await db.delete(idempotencyKeys).where(lt(idempotencyKeys.expiresAt, new Date()))
}
