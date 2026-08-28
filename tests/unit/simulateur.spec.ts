import { describe, expect, it } from 'vitest'
import { useSimulateur } from '../../app/composables/useSimulateur.ts'
import { useMoney } from '../../app/composables/useMoney.ts'

const { phrase, potParTour, duree } = useSimulateur()
const { format } = useMoney()

describe('simulateur du wizard — acceptation T10', () => {
  it('affiche « 12 × 10 000 FCFA = 120 000 FCFA par tour, sur 12 mois »', () => {
    const rendu = phrase(10_000, 12, 'monthly')

    expect(rendu).toBe(`12 × ${format(10_000)} = ${format(120_000)} par tour, sur 12 mois.`)
    // Le format des montants passe par useMoney : espace fine insécable comprise.
    expect(rendu).toContain('10 000 FCFA')
    expect(rendu).toContain('120 000 FCFA')
  })

  it('se met à jour à chaque changement de réglage', () => {
    expect(phrase(10_000, 12, 'monthly')).not.toBe(phrase(10_001, 12, 'monthly'))
    expect(phrase(10_000, 12, 'monthly')).not.toBe(phrase(10_000, 13, 'monthly'))
    expect(phrase(10_000, 12, 'monthly')).not.toBe(phrase(10_000, 12, 'weekly'))
  })

  it('accorde la durée à la fréquence', () => {
    expect(duree(12, 'monthly')).toBe('12 mois')
    expect(duree(12, 'weekly')).toBe('12 semaines')
    expect(duree(12, 'daily')).toBe('12 jours')
    expect(duree(12, 'biweekly')).toBe('12 quinzaines')
  })

  it('accorde le singulier', () => {
    expect(duree(1, 'weekly')).toBe('1 semaine')
    expect(duree(1, 'monthly')).toBe('1 mois')
  })

  it('ne rend rien tant qu’un réglage manque', () => {
    // Un pot à zéro n'est pas « 0 FCFA par tour », c'est une saisie inachevée.
    expect(phrase(0, 12, 'monthly')).toBe('')
    expect(phrase(10_000, 0, 'monthly')).toBe('')
  })

  it('calcule le pot comme montant de part × nombre de parts', () => {
    // Règle de calcul n°1 : toutes parts confondues, bénéficiaire inclus.
    expect(potParTour(25_000, 7)).toBe(175_000)
    expect(potParTour(10_000, 12)).toBe(120_000)
  })

  it('refuse un montant de part non entier', () => {
    // Le simulateur passe par useMoney, qui lève : un décimal ici signale un
    // calcul fautif en amont, pas un cas d'affichage.
    expect(() => phrase(10_000.5, 12, 'monthly')).toThrow(TypeError)
  })
})
