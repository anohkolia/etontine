import { describe, expect, it } from 'vitest'
import { estimerFrais, referenceCourte } from '../../server/services/frais.ts'
import type { Bareme } from '../../server/services/frais.ts'

const NEUTRE = { percent: 0, fixed: 0, min: 0, max: 0 }

function bareme(partiel: Partial<Bareme> = {}): Bareme {
  return {
    configured: true,
    wave: { ...NEUTRE },
    orange: { ...NEUTRE },
    mtn: { ...NEUTRE },
    moov: { ...NEUTRE },
    cash: { ...NEUTRE },
    ...partiel,
  }
}

describe('frais — acceptation T14 : aucun taux codé en dur', () => {
  it('ne renvoie aucun montant tant que la grille n’est pas renseignée', () => {
    // Annoncer un montant faux est pire que de ne rien annoncer : le membre
    // enverrait la mauvaise somme, et sa cotisation apparaîtrait incomplète.
    const frais = estimerFrais(bareme({ configured: false }), 'wave', 25_000, 'member')

    expect(frais.amount).toBeNull()
    expect(frais.totalToSend).toBe(25_000)
  })

  it('lit le taux dans la configuration, pas dans le code', () => {
    const un = estimerFrais(bareme({ wave: { percent: 1, fixed: 0, min: 0, max: 0 } }), 'wave', 25_000, 'member')
    const deux = estimerFrais(bareme({ wave: { percent: 2, fixed: 0, min: 0, max: 0 } }), 'wave', 25_000, 'member')

    expect(un.amount).toBe(250)
    expect(deux.amount).toBe(500)
  })

  it('applique un montant fixe en plus du pourcentage', () => {
    const frais = estimerFrais(bareme({ wave: { percent: 1, fixed: 100, min: 0, max: 0 } }), 'wave', 10_000, 'member')
    expect(frais.amount).toBe(200)
  })

  it('respecte le plancher et le plafond', () => {
    const plancher = estimerFrais(bareme({ wave: { percent: 1, fixed: 0, min: 500, max: 0 } }), 'wave', 10_000, 'member')
    expect(plancher.amount).toBe(500)

    const plafond = estimerFrais(bareme({ wave: { percent: 1, fixed: 0, min: 0, max: 1_000 } }), 'wave', 500_000, 'member')
    expect(plafond.amount).toBe(1_000)
  })

  it('arrondit au franc supérieur', () => {
    // Un membre qui envoie un franc de moins que le dû voit sa cotisation
    // refusée : on arrondit toujours dans le sens qui le protège.
    const frais = estimerFrais(bareme({ wave: { percent: 1.5, fixed: 0, min: 0, max: 0 } }), 'wave', 10_001, 'member')

    expect(Number.isInteger(frais.amount)).toBe(true)
    expect(frais.amount).toBe(151)
  })

  it('ajoute les frais à l’envoi quand ils sont à la charge du membre', () => {
    const frais = estimerFrais(bareme({ wave: { percent: 1, fixed: 0, min: 0, max: 0 } }), 'wave', 25_000, 'member')
    expect(frais.totalToSend).toBe(25_250)
  })

  it('laisse le montant nu quand la tontine prend les frais', () => {
    const frais = estimerFrais(bareme({ wave: { percent: 1, fixed: 0, min: 0, max: 0 } }), 'wave', 25_000, 'tontine')

    // La tontine les absorbe sur le pot : le membre envoie exactement son dû.
    expect(frais.amount).toBe(250)
    expect(frais.totalToSend).toBe(25_000)
  })

  it('distingue les opérateurs', () => {
    const grille = bareme({
      wave: { percent: 1, fixed: 0, min: 0, max: 0 },
      orange: { percent: 2, fixed: 50, min: 0, max: 0 },
    })

    expect(estimerFrais(grille, 'wave', 10_000, 'member').amount).toBe(100)
    expect(estimerFrais(grille, 'orange', 10_000, 'member').amount).toBe(250)
  })
})

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
