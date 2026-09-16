import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  BLOCAGE_MS, ESSAIS_MAX, SESSION_FRAICHE_MS, reinitialiserCompteurs, retirerCodeVerrou,
  sessionFraiche, verifierCodeVerrou,
} from '../../server/services/verrou.ts'
import { hashPin } from '../../server/utils/pin.ts'
import { sessions, users } from '../../server/db/schema.ts'
import type { User } from '../../server/db/schema.ts'
import { createTestDb, createTestUser } from '../helpers/db.ts'
import type { TestDb } from '../helpers/db.ts'

/**
 * Le verrou d'écran côté serveur : la vérification du code, ses essais
 * limités, et la porte de sortie « code oublié » par connexion SMS fraîche.
 */

let db: TestDb
let cleanup: () => Promise<void>

const U = 'f0000000-0000-4000-8000-000000000001'
const T0 = Date.parse('2026-03-01T10:00:00Z')

async function utilisateur(): Promise<User> {
  return (await db.select().from(users).where(eq(users.id, U)))[0]!
}

function erreur(statut: number, motif?: RegExp) {
  return expect.objectContaining({
    statusCode: statut,
    ...(motif
      ? { data: { error: expect.objectContaining({ message: expect.stringMatching(motif) }) } }
      : {}),
  })
}

beforeEach(async () => {
  const ctx = await createTestDb()
  db = ctx.db
  cleanup = ctx.cleanup
  reinitialiserCompteurs()
  await createTestUser(db, U, '+2250707000001')
  await db.update(users).set({ pinHash: hashPin('1234') }).where(eq(users.id, U))
})

afterEach(() => cleanup())

describe('vérification du code', () => {
  it('accepte le bon code', async () => {
    const u = await utilisateur()
    expect(verifierCodeVerrou(u, '1234', T0)).toEqual({ ok: true })
  })

  it('refuse un mauvais code en disant combien d’essais restent', async () => {
    const u = await utilisateur()
    expect(() => verifierCodeVerrou(u, '0000', T0)).toThrow(erreur(403, /4 essais/))
    expect(() => verifierCodeVerrou(u, '0000', T0)).toThrow(erreur(403, /3 essais/))
  })

  it('bloque quinze minutes après cinq échecs, même pour le bon code', async () => {
    const u = await utilisateur()
    for (let i = 0; i < ESSAIS_MAX - 1; i++) {
      expect(() => verifierCodeVerrou(u, '0000', T0)).toThrow(erreur(403))
    }
    expect(() => verifierCodeVerrou(u, '0000', T0)).toThrow(erreur(429))

    // Le bon code ne passe pas pendant le blocage : sinon il suffirait de
    // l'essayer entre deux mauvais.
    expect(() => verifierCodeVerrou(u, '1234', T0 + 60_000)).toThrow(erreur(429, /minute/))

    // Une fois le délai écoulé, on repart.
    expect(verifierCodeVerrou(u, '1234', T0 + BLOCAGE_MS + 1)).toEqual({ ok: true })
  })

  it('remet le compteur à zéro après un succès', async () => {
    const u = await utilisateur()
    expect(() => verifierCodeVerrou(u, '0000', T0)).toThrow(erreur(403))
    verifierCodeVerrou(u, '1234', T0)
    expect(() => verifierCodeVerrou(u, '0000', T0)).toThrow(erreur(403, /4 essais/))
  })

  it('refuse de vérifier quand aucun code n’est défini', async () => {
    await retirerCodeVerrou(db, U)
    const u = await utilisateur()
    expect(() => verifierCodeVerrou(u, '1234', T0)).toThrow(erreur(409))
  })
})

describe('code oublié — la connexion SMS fraîche', () => {
  async function ouvrirSession(id: string, ilYA: number) {
    await db.insert(sessions).values({
      id,
      userId: U,
      expiresAt: new Date(T0 + 86_400_000),
      createdAt: new Date(T0 - ilYA),
    })
  }

  it('reconnaît une session de moins de dix minutes', async () => {
    await ouvrirSession('s-fraiche', 60_000)
    expect(await sessionFraiche(db, 's-fraiche', T0)).toBe(true)
  })

  it('refuse une session plus ancienne, ou absente', async () => {
    await ouvrirSession('s-vieille', SESSION_FRAICHE_MS + 1)
    expect(await sessionFraiche(db, 's-vieille', T0)).toBe(false)
    expect(await sessionFraiche(db, undefined, T0)).toBe(false)
    expect(await sessionFraiche(db, 'inconnue', T0)).toBe(false)
  })

  it('retirer le code efface aussi les échecs', async () => {
    const u = await utilisateur()
    expect(() => verifierCodeVerrou(u, '0000', T0)).toThrow(erreur(403))
    await retirerCodeVerrou(db, U)
    expect((await utilisateur()).pinHash).toBeNull()
  })
})
