import { describe, expect, it } from 'vitest'
import { referenceCourte } from '../../server/services/references.ts'

describe('référence courte', () => {
  it('respecte le format TON-XXXX du schéma partagé', () => {
    expect(referenceCourte('a0000000-0000-4000-8000-000000000001')).toMatch(/^TON-[A-Z0-9]{4}$/)
  })

  it('est stable : le membre retrouve la référence qu’il a recopiée', () => {
    const id = 'a0000000-0000-4000-8000-000000000001'
    expect(referenceCourte(id)).toBe(referenceCourte(id))
  })

  it('diffère d’une cotisation à l’autre', () => {
    const references = new Set(
      Array.from({ length: 200 }, (_, i) =>
        referenceCourte(`a0000000-0000-4000-8000-${String(i).padStart(12, '0')}`)),
    )
    // Quelques collisions sont acceptables sur 200 tirages — la référence sert
    // à distinguer des envois d'un même tour, pas à identifier globalement.
    expect(references.size).toBeGreaterThan(180)
  })

  it('évite les caractères qui se confondent à la lecture', () => {
    // Ni I, ni L, ni O, ni 0, ni 1 : la référence est dictée au téléphone et
    // recopiée à la main dans l'application de paiement.
    for (let i = 0; i < 300; i++) {
      const reference = referenceCourte(`id-${i}`)
      expect(reference.slice(4)).not.toMatch(/[ILO01]/)
    }
  })
})
