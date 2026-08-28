import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runIdempotent } from '../../server/utils/idempotency.ts'
import { idempotencyKeys, tontines } from '../../server/db/schema.ts'
import { createTestDb, createTestUser } from '../helpers/db.ts'
import type { TestDb } from '../helpers/db.ts'

let db: TestDb
let cleanup: () => void

beforeEach(async () => {
  const ctx = createTestDb()
  db = ctx.db
  cleanup = ctx.cleanup
  await createTestUser(db, 'u1', '+2250707000001')
})

afterEach(() => cleanup())

/** Une opération qui crée réellement une ligne — c'est ce qu'on veut voir ne pas doubler. */
function creerTontine(suffixe: string) {
  return async () => {
    const id = `t-${suffixe}`
    await db.insert(tontines).values({
      id,
      name: 'Tontine des tantines',
      shareAmount: 25_000,
      frequency: 'monthly',
      startDate: '2026-01-01',
      createdBy: 'u1',
    })
    return { id, created: true }
  }
}

const params = { key: 'cle-abc', userId: 'u1', endpoint: 'POST /api/v1/tontines', body: { name: 'X' } }

describe('idempotence — acceptation T05', () => {
  it('le rejeu d’une clé ne crée pas de second enregistrement', async () => {
    let appels = 0
    const operation = async () => {
      appels++
      return creerTontine('un')()
    }

    const premier = await runIdempotent(db, params, operation)
    const second = await runIdempotent(db, params, operation)

    // L'opération n'a tourné qu'une fois…
    expect(appels).toBe(1)
    expect(second.replayed).toBe(true)
    expect(premier.replayed).toBe(false)

    // …et surtout, la base ne contient qu'une tontine.
    const lignes = await db.select().from(tontines)
    expect(lignes).toHaveLength(1)
  })

  it('renvoie exactement la réponse d’origine, pas une réponse recalculée', async () => {
    const premier = await runIdempotent(db, params, creerTontine('deux'))
    const second = await runIdempotent(db, params, creerTontine('deux'))

    expect(second.result).toEqual(premier.result)
  })

  it('refuse la même clé avec un corps différent', async () => {
    await runIdempotent(db, params, creerTontine('trois'))

    // Réutiliser une clé pour autre chose n'est pas un rejeu, c'est un bug
    // d'appelant : on refuse au lieu de renvoyer la réponse d'une autre opération.
    await expect(
      runIdempotent(db, { ...params, body: { name: 'Autre' } }, creerTontine('quatre')),
    ).rejects.toMatchObject({
      statusCode: 409,
      data: { error: { code: 'IDEMPOTENCY_CONFLICT' } },
    })

    expect(await db.select().from(tontines)).toHaveLength(1)
  })

  it('ne confond pas l’ordre des clés du corps de requête', async () => {
    // Le hachage passe par un JSON canonique : `{a,b}` et `{b,a}` sont le même
    // corps. Sans cela, un client qui sérialise différemment verrait un conflit.
    await runIdempotent(db, { ...params, body: { a: 1, b: 2 } }, creerTontine('cinq'))
    const rejeu = await runIdempotent(db, { ...params, body: { b: 2, a: 1 } }, creerTontine('six'))

    expect(rejeu.replayed).toBe(true)
    expect(await db.select().from(tontines)).toHaveLength(1)
  })

  it('isole les clés par utilisateur et par point d’entrée', async () => {
    await createTestUser(db, 'u2', '+2250707000002')
    await runIdempotent(db, params, creerTontine('sept'))

    // Même clé, autre point d'entrée : deux opérations distinctes.
    const autreRoute = await runIdempotent(
      db,
      { ...params, endpoint: 'POST /api/v1/contributions/x/declare' },
      creerTontine('huit'),
    )
    expect(autreRoute.replayed).toBe(false)

    expect(await db.select().from(idempotencyKeys)).toHaveLength(2)
    expect(await db.select().from(tontines)).toHaveLength(2)
  })

  it('conserve la trace de la clé pour la fenêtre de rejeu', async () => {
    await runIdempotent(db, params, creerTontine('neuf'))
    const [trace] = await db.select().from(idempotencyKeys)

    expect(trace?.key).toBe('cle-abc')
    expect(trace?.endpoint).toBe('POST /api/v1/tontines')
    // 24 h, comme le prévoit docs/api-contract.md.
    expect(trace!.expiresAt.getTime() - Date.now()).toBeGreaterThan(23 * 3600 * 1000)
  })
})
