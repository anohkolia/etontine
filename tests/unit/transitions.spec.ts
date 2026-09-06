import { describe, expect, it } from 'vitest'
import { assertTransition, canTransition, nextStates } from '../../server/utils/transitions.ts'
import { TRANSITIONS } from '#shared/schemas'

describe('assertTransition — acceptation T05', () => {
  it('refuse une transition interdite avec 409 INVALID_TRANSITION', () => {
    // Une cotisation confirmée est un état final : on ne la « redéclare » pas.
    try {
      assertTransition('contribution', 'confirmed', 'declared')
      expect.unreachable('la transition aurait dû être refusée')
    }
    catch (e) {
      const err = e as { statusCode: number, data: { error: { code: string, message: string, field?: string } } }
      expect(err.statusCode).toBe(409)
      expect(err.data.error.code).toBe('INVALID_TRANSITION')
      expect(err.data.error.field).toBe('status')
      // Le message dit ce qui était possible : sans cela, diagnostiquer un 409
      // en production oblige à rouvrir le code.
      expect(err.data.error.message).toContain('état final')
    }
  })

  it('nomme les états possibles quand il y en a', () => {
    try {
      assertTransition('contribution', 'due', 'confirmed')
      expect.unreachable('la transition aurait dû être refusée')
    }
    catch (e) {
      const err = e as { data: { error: { message: string } } }
      // Sauter la déclaration pour confirmer directement, c'est exactement ce
      // que la règle 1 interdit : le client ne décide pas de l'état.
      expect(err.data.error.message).toContain('« declared »')
      expect(err.data.error.message).toContain('« late »')
    }
  })

  it('refuse un état de départ inconnu', () => {
    try {
      assertTransition('contribution', 'encaisse', 'confirmed')
      expect.unreachable()
    }
    catch (e) {
      const err = e as { statusCode: number, data: { error: { code: string } } }
      expect(err.statusCode).toBe(409)
      expect(err.data.error.code).toBe('INVALID_TRANSITION')
    }
  })

  it('laisse passer les transitions listées', () => {
    expect(() => assertTransition('contribution', 'due', 'declared')).not.toThrow()
    expect(() => assertTransition('contribution', 'declared', 'confirmed')).not.toThrow()
    expect(() => assertTransition('round', 'payout_pending', 'closed')).not.toThrow()
    expect(() => assertTransition('payout', 'declared', 'acknowledged')).not.toThrow()
    expect(() => assertTransition('tontine', 'open', 'running')).not.toThrow()
  })
})

describe('les six machines à états sont couvertes', () => {
  it('expose contribution, payout, round, tontine, membership et l’abonnement', () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual(
      ['contribution', 'membership', 'payout', 'round', 'subscriptionRequest', 'tontine'],
    )
  })

  it('n’autorise aucune sortie depuis un état final', () => {
    // Les états finaux du modèle : une écriture d'argent aboutie ne se rejoue pas.
    expect(nextStates('contribution', 'confirmed')).toEqual([])
    expect(nextStates('payout', 'acknowledged')).toEqual([])
    expect(nextStates('round', 'closed')).toEqual([])
    expect(nextStates('tontine', 'archived')).toEqual([])
    expect(nextStates('membership', 'left')).toEqual([])
    // Une demande d'abonnement décidée est définitive : on la refait, on ne la
    // rouvre pas. Le back-office garde ainsi qui a décidé quoi, et quand.
    expect(nextStates('subscriptionRequest', 'approved')).toEqual([])
    expect(nextStates('subscriptionRequest', 'rejected')).toEqual([])
  })

  it('ne désigne jamais un état de destination inconnu de sa propre machine', () => {
    // Une faute de frappe dans une table rendrait une transition inatteignable
    // sans qu'aucun test métier ne s'en aperçoive.
    for (const [machine, table] of Object.entries(TRANSITIONS)) {
      const etats = Object.keys(table)
      for (const [depuis, vers] of Object.entries(table as Record<string, readonly string[]>)) {
        for (const cible of vers) {
          expect(etats, `${machine}: ${depuis} → ${cible} vise un état inexistant`).toContain(cible)
        }
      }
    }
  })

  it('refuse un retour arrière sur le versement du pot', () => {
    // docs/data-model.md §2.5 : `declared → acknowledged` est à sens unique,
    // et seul le bénéficiaire pose cet état.
    expect(canTransition('payout', 'acknowledged', 'declared')).toBe(false)
    expect(canTransition('payout', 'declared', 'prepared')).toBe(false)
  })

  it('ne permet pas de clore un tour sans passer par le versement', () => {
    expect(canTransition('round', 'collecting', 'closed')).toBe(false)
  })
})
