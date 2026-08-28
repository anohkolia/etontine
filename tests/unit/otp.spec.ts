import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { phoneCI } from '#shared/schemas'
import { ECHECS_AVANT_VOCAL, failedAttempts, requestOtp, verifyOtp } from '../../server/services/otp.ts'
import { users } from '../../server/db/schema.ts'
import { createTestDb } from '../helpers/db.ts'
import type { TestDb } from '../helpers/db.ts'

let db: TestDb
let cleanup: () => void

const NUMERO = '+2250707123456'

beforeEach(() => {
  const ctx = createTestDb()
  db = ctx.db
  cleanup = ctx.cleanup
  vi.useRealTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('normalisation E.164 — acceptation T07', () => {
  it.each([
    ['0707123456', '+2250707123456'],
    ['+2250707123456', '+2250707123456'],
    ['07 07 12 34 56', '+2250707123456'],
    ['07.07.12.34.56', '+2250707123456'],
    ['(07) 07-12-34-56', '+2250707123456'],
  ])('normalise « %s » en %s', (saisie, attendu) => {
    // Règle 20 : le numéro est en E.164 **avant toute persistance**. Sans cela,
    // le même membre existe deux fois selon la façon dont il a tapé son numéro.
    expect(phoneCI.parse(saisie)).toBe(attendu)
  })

  it('refuse un préfixe qui n’est pas un mobile ivoirien', () => {
    expect(() => phoneCI.parse('0207123456')).toThrow()
    expect(() => phoneCI.parse('+33612345678')).toThrow()
    expect(() => phoneCI.parse('070712345')).toThrow() // un chiffre de trop peu
  })
})

describe('demande de code', () => {
  it('répond la même chose que le numéro existe ou non', async () => {
    // Acceptation T07. Une réponse différenciée ferait de ce point d'entrée un
    // annuaire : on saurait qui est inscrit en essayant des numéros.
    const inconnu = await requestOtp(db, '+2250707000099')

    await db.insert(users).values({ id: 'u1', phone: NUMERO })
    const connu = await requestOtp(db, NUMERO)

    expect(Object.keys(inconnu).sort()).toEqual(Object.keys(connu).sort())
    expect(inconnu.ok).toBe(connu.ok)
    expect(inconnu.resendAfterSeconds).toBe(connu.resendAfterSeconds)
  })

  it('ne crée pas de compte à la demande de code', async () => {
    await requestOtp(db, NUMERO)
    // Le compte naît à la vérification, sinon un inconnu peuple la base de
    // comptes fantômes en saisissant des numéros au hasard.
    expect(await db.select().from(users)).toHaveLength(0)
  })

  it('impose un délai de 30 secondes avant un renvoi', async () => {
    await requestOtp(db, NUMERO)
    await expect(requestOtp(db, NUMERO)).rejects.toMatchObject({
      statusCode: 429,
      data: { error: { code: 'RATE_LIMITED' } },
    })
  })

  it('limite à trois demandes par dix minutes', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-27T10:00:00Z'))

    await requestOtp(db, NUMERO)
    vi.advanceTimersByTime(60_000)
    await requestOtp(db, NUMERO)
    vi.advanceTimersByTime(60_000)
    await requestOtp(db, NUMERO)
    vi.advanceTimersByTime(60_000)

    await expect(requestOtp(db, NUMERO)).rejects.toMatchObject({
      statusCode: 429,
      data: { error: { code: 'RATE_LIMITED' } },
    })
  })
})

describe('vérification du code', () => {
  it('crée le compte au premier code validé, et pas au second', async () => {
    const { devCode } = await requestOtp(db, NUMERO)
    const premier = await verifyOtp(db, NUMERO, devCode!)

    expect(premier.isNewUser).toBe(true)
    expect(await db.select().from(users)).toHaveLength(1)

    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 60_000)
    const { devCode: second } = await requestOtp(db, NUMERO)
    const suivant = await verifyOtp(db, NUMERO, second!)

    expect(suivant.isNewUser).toBe(false)
    expect(suivant.userId).toBe(premier.userId)
    expect(await db.select().from(users)).toHaveLength(1)
  })

  it('refuse un code faux et compte l’échec', async () => {
    await requestOtp(db, NUMERO)

    await expect(verifyOtp(db, NUMERO, '000000')).rejects.toMatchObject({
      statusCode: 422,
      data: { error: { code: 'VALIDATION_ERROR', field: 'code' } },
    })
    expect(failedAttempts(db, NUMERO)).toBe(1)
  })

  it('ouvre le repli vocal après deux échecs', async () => {
    await requestOtp(db, NUMERO)
    await expect(verifyOtp(db, NUMERO, '000000')).rejects.toThrow()
    await expect(verifyOtp(db, NUMERO, '000001')).rejects.toThrow()

    // Le SMS n'arrive pas toujours : réseau saturé, numéro porté, filtrage.
    expect(failedAttempts(db, NUMERO)).toBeGreaterThanOrEqual(ECHECS_AVANT_VOCAL)
  })

  it('ne rejoue pas un code déjà consommé', async () => {
    const { devCode } = await requestOtp(db, NUMERO)
    await verifyOtp(db, NUMERO, devCode!)

    await expect(verifyOtp(db, NUMERO, devCode!)).rejects.toMatchObject({
      data: { error: { message: expect.stringContaining('expiré') } },
    })
  })

  it('refuse un code expiré', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-27T10:00:00Z'))
    const { devCode } = await requestOtp(db, NUMERO)

    // Cinq minutes de validité : un code qui traîne est un code volé.
    vi.setSystemTime(new Date('2026-08-27T10:06:00Z'))
    await expect(verifyOtp(db, NUMERO, devCode!)).rejects.toThrow()
  })

  it('bloque après cinq essais sur le même code', async () => {
    await requestOtp(db, NUMERO)
    for (let i = 0; i < 5; i++) {
      await expect(verifyOtp(db, NUMERO, String(i).padStart(6, '0'))).rejects.toThrow()
    }
    await expect(verifyOtp(db, NUMERO, '999999')).rejects.toMatchObject({
      data: { error: { code: 'RATE_LIMITED' } },
    })
  })

  it('ne stocke jamais le code en clair', async () => {
    const { devCode } = await requestOtp(db, NUMERO)
    const { otpRequests } = await import('../../server/db/schema.ts')
    const lignes = await db.select().from(otpRequests)

    // Sans cette garde, le test passerait à vide le jour où `devCode` cesse
    // d'être renseigné — ce qui est précisément arrivé une fois.
    expect(devCode).toMatch(/^\d{6}$/)
    expect(lignes[0]!.codeHash).not.toContain(devCode!)
    expect(lignes[0]!.codeHash).toMatch(/^[0-9a-f]{64}$/)
  })
})
