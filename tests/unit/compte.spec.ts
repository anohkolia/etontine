import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  appliquerChangementNumero, blocagesSuppression, demanderChangementNumero, exporterDonnees,
} from '../../server/services/compte.ts'
import { consommerCode, requestOtp } from '../../server/services/otp.ts'
import { hashPin, verifyPin } from '../../server/utils/pin.ts'
import {
  contributions, ledgerEntries, memberships, notifications, rounds, shares, tontines, users,
} from '../../server/db/schema.ts'
import { createTestDb, createTestUser } from '../helpers/db.ts'
import type { TestDb } from '../helpers/db.ts'

let db: TestDb
let cleanup: () => void

const U = 'b0000000-0000-4000-8000-000000000001'
const AUTRE = 'b0000000-0000-4000-8000-000000000002'
const T = 'b0000000-0000-4000-8000-000000000010'

beforeEach(async () => {
  const ctx = createTestDb()
  db = ctx.db
  cleanup = ctx.cleanup

  await createTestUser(db, U, '+2250707000001')
  await createTestUser(db, AUTRE, '+2250707000002')
  await db.insert(tontines).values({
    id: T, name: 'Tontine des tantines', shareAmount: 25_000,
    frequency: 'monthly', startDate: '2026-01-01', createdBy: U, status: 'running',
  })
})

afterEach(() => cleanup())

async function poserMembre(id: string, userId: string, position: number) {
  await db.insert(memberships).values({ id, tontineId: T, userId, status: 'active' })
  await db.insert(shares).values({
    id: `${id}-s`, tontineId: T, membershipId: id, rotationPosition: position,
  })
  return `${id}-s`
}

describe('suppression de compte — acceptation T08', () => {
  it('liste les tours en cours qui bloquent, au lieu d’un refus opaque', async () => {
    const partA = await poserMembre('ms-a', U, 1)
    await poserMembre('ms-b', AUTRE, 2)

    await db.insert(rounds).values({
      id: 'r1', tontineId: T, index: 1, dueDate: '2026-02-01',
      beneficiaryShareId: partA, expectedAmount: 50_000, status: 'collecting',
    })

    const blocages = blocagesSuppression(db, U)

    expect(blocages).toHaveLength(1)
    expect(blocages[0]).toMatchObject({ tontineName: 'Tontine des tantines', roundIndex: 1 })
    // Le membre doit savoir ce qui le retient et pouvoir agir dessus.
    expect(blocages[0]!.raison).toContain('cours de cotisation')
  })

  it('bloque aussi tant que le pot d’un tour n’est pas versé', async () => {
    const partA = await poserMembre('ms-a', U, 1)
    await db.insert(rounds).values({
      id: 'r1', tontineId: T, index: 2, dueDate: '2026-02-01',
      beneficiaryShareId: partA, expectedAmount: 50_000, status: 'payout_pending',
    })

    expect(blocagesSuppression(db, U)[0]!.raison).toContain('versé')
  })

  it('bloque un membre qui n’a pas encore pris la main', async () => {
    const partA = await poserMembre('ms-a', U, 1)
    await db.insert(rounds).values({
      id: 'r1', tontineId: T, index: 1, dueDate: '2026-02-01',
      beneficiaryShareId: partA, expectedAmount: 50_000, status: 'pending',
    })

    // Partir maintenant, c'est avoir cotisé pour rien.
    expect(blocagesSuppression(db, U)[0]!.raison).toContain('pas encore pris la main')
  })

  it('ne bloque rien quand tout est clos', async () => {
    const partA = await poserMembre('ms-a', U, 1)
    await db.insert(rounds).values({
      id: 'r1', tontineId: T, index: 1, dueDate: '2026-02-01',
      beneficiaryShareId: partA, expectedAmount: 50_000, status: 'closed',
    })

    expect(blocagesSuppression(db, U)).toEqual([])
  })

  it('ne bloque pas pour la tontine d’un autre membre', async () => {
    const partB = await poserMembre('ms-b', AUTRE, 1)
    await db.insert(rounds).values({
      id: 'r1', tontineId: T, index: 1, dueDate: '2026-02-01',
      beneficiaryShareId: partB, expectedAmount: 50_000, status: 'collecting',
    })

    expect(blocagesSuppression(db, U)).toEqual([])
  })
})

describe('export des données personnelles', () => {
  it('n’expose rien sur les autres membres', async () => {
    const partA = await poserMembre('ms-a', U, 1)
    await poserMembre('ms-b', AUTRE, 2)
    await db.insert(rounds).values({
      id: 'r1', tontineId: T, index: 1, dueDate: '2026-02-01',
      beneficiaryShareId: partA, expectedAmount: 50_000, status: 'collecting',
    })
    await db.insert(contributions).values([
      { id: 'c1', roundId: 'r1', shareId: partA, membershipId: 'ms-a', expectedAmount: 25_000, dueDate: '2026-02-01' },
      { id: 'c2', roundId: 'r1', shareId: 'ms-b-s', membershipId: 'ms-b', expectedAmount: 25_000, dueDate: '2026-02-01' },
    ])

    const donnees = exporterDonnees(db, U)
    const texte = JSON.stringify(donnees)

    expect(donnees.cotisations).toHaveLength(1)
    // Un export de données ne doit pas devenir un moyen d'aspirer le carnet
    // d'adresses d'une tontine.
    expect(texte).not.toContain('+2250707000002')
    expect(texte).not.toContain('ms-b')
  })

  it('contient les deux consentements séparément', async () => {
    const donnees = exporterDonnees(db, U)
    expect(donnees.profil).toHaveProperty('consentDataAt')
    expect(donnees.profil).toHaveProperty('consentNotificationsAt')
  })
})

describe('code de verrouillage', () => {
  it('ne stocke jamais le code, et vérifie correctement', () => {
    const empreinte = hashPin('1234')

    expect(empreinte).not.toContain('1234')
    expect(verifyPin('1234', empreinte)).toBe(true)
    expect(verifyPin('1235', empreinte)).toBe(false)
  })

  it('sale chaque code : deux membres avec « 1234 » n’ont pas la même empreinte', () => {
    // Sans sel, une seule attaque ouvrirait tous les comptes ayant choisi le
    // même code — et « 1234 » est un choix fréquent.
    expect(hashPin('1234')).not.toBe(hashPin('1234'))
  })

  it('refuse une empreinte malformée sans lever', () => {
    expect(verifyPin('1234', 'nimportequoi')).toBe(false)
    expect(verifyPin('1234', '')).toBe(false)
  })
})

describe('changement de numéro', () => {
  const T2 = 'b0000000-0000-4000-8000-000000000011'

  async function membreAvecBureau() {
    // U est membre actif de T, où AUTRE est président ; et de T2, sans bureau à prévenir.
    await db.insert(memberships).values({ id: 'ms-u', tontineId: T, userId: U, status: 'active', role: 'member' })
    await db.insert(memberships).values({ id: 'ms-p', tontineId: T, userId: AUTRE, status: 'active', role: 'president' })
    await db.insert(tontines).values({
      id: T2, name: 'Autre tontine', shareAmount: 5_000, frequency: 'weekly', startDate: '2026-01-01', createdBy: U,
    })
    await db.insert(memberships).values({ id: 'ms-u2', tontineId: T2, userId: U, status: 'active', role: 'president' })
  }

  it('refuse le numéro actuel, et un numéro déjà pris', () => {
    expect(() => demanderChangementNumero(db, U, '+2250707000001')).toThrow(
      expect.objectContaining({ statusCode: 422 }),
    )
    expect(() => demanderChangementNumero(db, U, '+2250707000002')).toThrow(
      expect.objectContaining({ statusCode: 422 }),
    )
    expect(() => demanderChangementNumero(db, U, '+2250707009999')).not.toThrow()
  })

  it('change le numéro et pose la date du changement — le gel de 48 h en découle', async () => {
    await membreAvecBureau()
    appliquerChangementNumero(db, U, '+2250707009999')

    const [u] = db.select().from(users).where(eq(users.id, U)).all()
    expect(u!.phone).toBe('+2250707009999')
    expect(u!.phoneChangedAt).toBeInstanceOf(Date)
    expect(Date.now() - u!.phoneChangedAt!.getTime()).toBeLessThan(5_000)
  })

  it('l’écrit au registre de chaque tontine active, sans le numéro en clair', async () => {
    await membreAvecBureau()
    appliquerChangementNumero(db, U, '+2250707009999')

    const ecritures = db.select().from(ledgerEntries).all()
      .filter(e => (e.payload as { changement?: string }).changement === 'numero_change')
    expect(ecritures.map(e => e.tontineId).sort()).toEqual([T, T2].sort())
    for (const e of ecritures) {
      expect(JSON.stringify(e.payload)).not.toContain('0707009999')
      expect(e.payload).toMatchObject({ ancienFin: '0001', nouveauFin: '9999' })
    }
  })

  it('prévient le bureau de chaque tontine, sans montant ni numéro', async () => {
    await membreAvecBureau()
    appliquerChangementNumero(db, U, '+2250707009999')

    const prevenus = db.select().from(notifications).all()
    expect(prevenus.map(n => n.userId)).toEqual([AUTRE])
    expect(prevenus[0]!.body).not.toContain('9999')
  })

  it('consommer un code ne crée jamais de compte', async () => {
    const { devCode } = await requestOtp(db, '+2250707009999')
    consommerCode(db, '+2250707009999', devCode!)
    expect(db.select().from(users).where(eq(users.phone, '+2250707009999')).all()).toHaveLength(0)
    // Et il ne se consomme qu'une fois.
    expect(() => consommerCode(db, '+2250707009999', devCode!)).toThrow(
      expect.objectContaining({ statusCode: 422 }),
    )
  })
})
