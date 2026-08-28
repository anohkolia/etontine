import { describe, expect, it } from 'vitest'
import {
  CONTRIBUTION_TRANSITIONS,
  PAYOUT_TRANSITIONS,
  ROUND_TRANSITIONS,
  amountFcfa,
  phoneCI,
} from '#shared/schemas'

/**
 * Tests de socle : ils ne couvrent pas encore la logique métier (T05 pour
 * `assertTransition()`, T03 pour `useMoney()`), mais ils vérifient que les
 * schémas partagés sont réellement importables des deux côtés et que les
 * invariants de CLAUDE.md tiennent dès le premier commit.
 */
describe('schémas partagés — accessibles client et serveur', () => {
  it('normalise un numéro ivoirien en E.164', () => {
    expect(phoneCI.parse('0707123456')).toBe('+2250707123456')
    expect(phoneCI.parse('07 07 12 34 56')).toBe('+2250707123456')
    expect(phoneCI.parse('+2250707123456')).toBe('+2250707123456')
  })

  it('refuse un numéro hors préfixes mobiles ivoiriens', () => {
    expect(() => phoneCI.parse('0207123456')).toThrow()
    expect(() => phoneCI.parse('+33612345678')).toThrow()
  })

  it('refuse un montant non entier — les FCFA n’ont pas de centimes', () => {
    expect(amountFcfa.parse(25_000)).toBe(25_000)
    expect(() => amountFcfa.parse(25_000.5)).toThrow()
    expect(() => amountFcfa.parse(-1)).toThrow()
  })
})

describe('tables de transitions — états terminaux', () => {
  it('une cotisation confirmée ne repart nulle part', () => {
    expect(CONTRIBUTION_TRANSITIONS.confirmed).toEqual([])
  })

  it('un versement accusé de réception est terminal', () => {
    expect(PAYOUT_TRANSITIONS.acknowledged).toEqual([])
  })

  it('un tour ne se clôt qu’après le versement en attente', () => {
    expect(ROUND_TRANSITIONS.payout_pending).toEqual(['closed'])
    expect(ROUND_TRANSITIONS.closed).toEqual([])
  })
})
