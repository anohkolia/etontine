import { describe, expect, it } from 'vitest'
import { useMoney } from '../../app/composables/useMoney'

const { format, formatAmount, formatOrDash } = useMoney()

/** Espace fine insécable U+202F — le séparateur imposé par la règle 7. */
const FINE = ' '
/** Espace insécable U+00A0, entre le nombre et la devise. */
const NBSP = ' '

describe('useMoney — format imposé par la règle 7', () => {
  it('formate 25000 en « 25 000 FCFA » avec espace fine insécable', () => {
    const rendu = format(25_000)

    expect(rendu).toBe(`25${FINE}000${NBSP}FCFA`)
    // Assertion explicite sur le point de code : une espace ordinaire passerait
    // inaperçue à la relecture, et casserait le rendu sur une ligne étroite.
    expect(rendu).toContain(FINE)
    expect(rendu).not.toContain(' ') // pas d'espace ordinaire U+0020
  })

  it('formate 0 en « 0 FCFA » — zéro est une information, pas un vide', () => {
    expect(format(0)).toBe(`0${NBSP}FCFA`)
  })

  it('groupe par milliers à tous les ordres de grandeur', () => {
    expect(format(100)).toBe(`100${NBSP}FCFA`)
    expect(format(1_000)).toBe(`1${FINE}000${NBSP}FCFA`)
    expect(format(120_000)).toBe(`120${FINE}000${NBSP}FCFA`)
    expect(format(1_500_000)).toBe(`1${FINE}500${FINE}000${NBSP}FCFA`)
    expect(format(12_345_678)).toBe(`12${FINE}345${FINE}678${NBSP}FCFA`)
  })

  it('refuse un montant non entier', () => {
    // Règle 6 : les FCFA n'ont pas de centimes. Un décimal ici trahit un calcul
    // fautif en amont ; l'arrondir à l'affichage le masquerait.
    expect(() => format(25_000.5)).toThrow(TypeError)
    expect(() => format(0.1)).toThrow(/non entier/)
    expect(() => format(Number.NaN)).toThrow(TypeError)
    expect(() => format(Number.POSITIVE_INFINITY)).toThrow(TypeError)
  })

  it('rend un montant négatif avec un vrai signe moins', () => {
    // U+2212, pas le trait d'union : un manquant au registre doit se lire.
    expect(format(-5_000)).toBe(`−5${FINE}000${NBSP}FCFA`)
  })

  it('rend le nombre seul, sans devise', () => {
    expect(formatAmount(25_000)).toBe(`25${FINE}000`)
  })

  it('distingue l’absence de valeur du zéro', () => {
    expect(formatOrDash(null)).toBe('—')
    expect(formatOrDash(undefined)).toBe('—')
    expect(formatOrDash(0)).toBe(`0${NBSP}FCFA`)
  })
})

describe('useMoney — indépendance à l’environnement', () => {
  it('produit exactement la suite de points de code attendue', () => {
    // Le formatage est manuel, donc insensible à la version d'ICU du système.
    // C'est tout l'intérêt de ne pas passer par Intl.NumberFormat : sur un
    // Android ancien, `fr-FR` peut rendre une espace ordinaire, une insécable
    // ou une fine insécable pour le même montant. Ici, plus de doute possible.
    const points = [...format(25_000)].map(c => c.codePointAt(0))

    expect(points).toEqual([
      0x32, 0x35, //   « 25 »
      0x202F, //        espace fine insécable
      0x30, 0x30, 0x30, // « 000 »
      0x00A0, //        espace insécable
      0x46, 0x43, 0x46, 0x41, // « FCFA »
    ])
  })
})
