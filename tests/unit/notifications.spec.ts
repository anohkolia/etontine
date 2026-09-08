import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { marquerLues, mesNotifications, notifier } from '../../server/services/notifications.ts'
import { notifications } from '../../server/db/schema.ts'
import { createTestDb, createTestUser } from '../helpers/db.ts'
import type { TestDb } from '../helpers/db.ts'

let db: TestDb
let cleanup: () => void

const MOI = 'd1000000-0000-4000-8000-000000000001'
const AUTRE = 'd1000000-0000-4000-8000-000000000002'

beforeEach(async () => {
  const ctx = createTestDb()
  db = ctx.db
  cleanup = ctx.cleanup

  await createTestUser(db, MOI, '+2250707000001')
  await createTestUser(db, AUTRE, '+2250707000002')
})

afterEach(() => cleanup())

/** `n` notifications à mon nom, écrites dans l'ordre. */
function poser(n: number, userId = MOI) {
  for (let i = 0; i < n; i++) {
    notifier(db, userId, {
      type: 'cotisation_confirmee',
      title: `Notification ${i}`,
      body: 'Le trésorier a confirmé ta cotisation.',
      url: '/app',
    })
  }
}

describe('mes notifications — la table n’était lisible par personne', () => {
  it('rend les miennes, et seulement les miennes', () => {
    poser(2)
    poser(3, AUTRE)

    const { items, unread } = mesNotifications(db, MOI)
    expect(items).toHaveLength(2)
    expect(unread).toBe(2)
    expect(items.every(n => n.userId === MOI)).toBe(true)
  })

  it('compte les non-lues sur tout, pas sur la page rendue', () => {
    poser(5)

    // L'en-tête affiche ce nombre : le limiter à la page chargée le rendrait
    // faux dès la deuxième notification.
    const { items, unread } = mesNotifications(db, MOI, { limit: 2 })
    expect(items).toHaveLength(2)
    expect(unread).toBe(5)
  })

  it('pagine par curseur, sans rien répéter ni sauter', () => {
    poser(5)

    const premiere = mesNotifications(db, MOI, { limit: 2 })
    expect(premiere.nextCursor).not.toBeNull()

    const seconde = mesNotifications(db, MOI, { limit: 2, cursor: Number(premiere.nextCursor) })
    const vus = [...premiere.items, ...seconde.items].map(n => n.id)
    expect(new Set(vus).size).toBe(vus.length)
  })

  it('marque tout lu quand on n’indique rien', () => {
    poser(3)
    expect(marquerLues(db, MOI)).toBe(3)
    expect(mesNotifications(db, MOI).unread).toBe(0)
  })

  it('ne marque jamais lues les notifications d’un autre', () => {
    poser(2, AUTRE)
    const [sienne] = db.select().from(notifications).where(eq(notifications.userId, AUTRE)).all()

    // Le filtre porte sur le destinataire, pas seulement sur l'identifiant
    // fourni : sans lui, connaître un identifiant suffirait.
    expect(marquerLues(db, MOI, [sienne!.id])).toBe(0)
    expect(mesNotifications(db, AUTRE).unread).toBe(2)
  })

  it('ne recompte pas ce qui est déjà lu', () => {
    poser(2)
    marquerLues(db, MOI)
    expect(marquerLues(db, MOI)).toBe(0)
  })
})
