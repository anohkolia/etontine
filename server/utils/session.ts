import { randomUUID } from 'node:crypto'
import { deleteCookie, getCookie, setCookie } from 'h3'
import type { H3Event } from 'h3'
import { and, eq, gt } from 'drizzle-orm'
import { useDb } from '../db/index.ts'
import { isProduction } from './env.ts'
import { sessions, users } from '../db/schema.ts'
import type { User } from '../db/schema.ts'

/** Nom du cookie de session. Une seule constante, jamais de littéral ailleurs. */
export const SESSION_COOKIE = 'tontine_session'

/** Durée de vie d'une session : 30 jours, glissante à chaque usage. */
const DUREE_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Session par cookie `httpOnly` (règle 19). Pas de JWT en `localStorage` : un
 * jeton qu'on ne peut pas révoquer n'a pas sa place dans une application qui
 * manipule de l'argent. Ici, supprimer la ligne suffit à couper l'accès.
 */
export async function createSession(event: H3Event, userId: string): Promise<string> {
  const db = useDb()
  const id = randomUUID()
  const expiresAt = new Date(Date.now() + DUREE_MS)

  await db.insert(sessions).values({
    id,
    userId,
    expiresAt,
    userAgent: event.node?.req?.headers?.['user-agent'] ?? null,
  })

  setCookie(event, SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction(),
    path: '/',
    expires: expiresAt,
  })

  return id
}

/** L'utilisateur de la session courante, ou `null`. Ne lève jamais. */
export async function getSessionUser(event: H3Event): Promise<User | null> {
  const id = getCookie(event, SESSION_COOKIE)
  if (!id) return null

  const db = useDb()
  const lignes = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    // L'expiration est vérifiée **en base**, pas d'après le cookie : un cookie
    // se falsifie, une ligne de session non.
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())))
    .limit(1)

  return lignes[0]?.user ?? null
}

export async function destroySession(event: H3Event): Promise<void> {
  const id = getCookie(event, SESSION_COOKIE)
  if (id) await useDb().delete(sessions).where(eq(sessions.id, id))
  deleteCookie(event, SESSION_COOKIE, { path: '/' })
}
