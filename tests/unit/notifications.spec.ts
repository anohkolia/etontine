import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { marquerLues, mesNotifications, notifier } from '../../server/services/notifications.ts'
import { notifications } from '../../server/db/schema.ts'
import { createTestDb, createTestUser } from '../helpers/db.ts'
import type { TestDb } from '../helpers/db.ts'

let db: TestDb
let cleanup: () => Promise<void>

const MOI = 'd1000000-0000-4000-8000-000000000001'
const AUTRE = 'd1000000-0000-4000-8000-000000000002'

beforeEach(async () => {
  const ctx = await createTestDb()
  db = ctx.db
  cleanup = ctx.cleanup

  await createTestUser(db, MOI, '+2250707000001')
  await createTestUser(db, AUTRE, '+2250707000002')
})

afterEach(() => cleanup())

/** `n` notifications à mon nom, écrites dans l'ordre. */
async function poser(n: number, userId = MOI) {
  for (let i = 0; i < n; i++) {
    await notifier(db, userId, {
      type: 'cotisation_confirmee',
      title: `Notification ${i}`,
      body: 'Le trésorier a confirmé ta cotisation.',
      url: '/app',
    })
  }
}

describe('mes notifications — la table n’était lisible par personne', () => {
  it('rend les miennes, et seulement les miennes', async () => {
    await poser(2)
    await poser(3, AUTRE)

    const { items, unread } = await mesNotifications(db, MOI)
    expect(items).toHaveLength(2)
    expect(unread).toBe(2)
    expect(items.every(n => n.userId === MOI)).toBe(true)
  })

  it('compte les non-lues sur tout, pas sur la page rendue', async () => {
    await poser(5)

    // L'en-tête affiche ce nombre : le limiter à la page chargée le rendrait
    // faux dès la deuxième notification.
    const { items, unread } = await mesNotifications(db, MOI, { limit: 2 })
    expect(items).toHaveLength(2)
    expect(unread).toBe(5)
  })

  it('pagine par curseur, sans rien répéter ni sauter', async () => {
    await poser(5)

    const premiere = await mesNotifications(db, MOI, { limit: 2 })
    expect(premiere.nextCursor).not.toBeNull()

    const seconde = await mesNotifications(db, MOI, { limit: 2, cursor: Number(premiere.nextCursor) })
    const vus = [...premiere.items, ...seconde.items].map(n => n.id)
    expect(new Set(vus).size).toBe(vus.length)
  })

  it('marque tout lu quand on n’indique rien', async () => {
    await poser(3)
    expect(await marquerLues(db, MOI)).toBe(3)
    expect((await mesNotifications(db, MOI)).unread).toBe(0)
  })

  it('ne marque jamais lues les notifications d’un autre', async () => {
    await poser(2, AUTRE)
    const [sienne] = await db.select().from(notifications).where(eq(notifications.userId, AUTRE))

    // Le filtre porte sur le destinataire, pas seulement sur l'identifiant
    // fourni : sans lui, connaître un identifiant suffirait.
    expect(await marquerLues(db, MOI, [sienne!.id])).toBe(0)
    expect((await mesNotifications(db, AUTRE)).unread).toBe(2)
  })

  it('ne recompte pas ce qui est déjà lu', async () => {
    await poser(2)
    await marquerLues(db, MOI)
    expect(await marquerLues(db, MOI)).toBe(0)
  })
})
