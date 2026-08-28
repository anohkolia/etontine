import { describe, expect, it } from 'vitest'
import { useDate } from '../../app/composables/useDate'

const { formatDate, formatDayAndDate, formatRelativeDay, daysUntil, isPast } = useDate()

/** Jeudi 27 août 2026, midi. */
const REFERENCE = new Date(2026, 7, 27, 12, 0, 0)

describe('useDate — formatage', () => {
  it('écrit la date en toutes lettres, en français', () => {
    expect(formatDate(new Date(2026, 7, 27))).toBe('27 août 2026')
    expect(formatDate(new Date(2026, 0, 1))).toBe('1 janvier 2026')
    expect(formatDate(new Date(2026, 11, 31))).toBe('31 décembre 2026')
  })

  it('écrit le jour de la semaine pour une date proche', () => {
    expect(formatDayAndDate(new Date(2026, 7, 27))).toBe('jeudi 27 août')
  })

  it('refuse une date invalide au lieu de rendre « Invalid Date »', () => {
    expect(() => formatDate('pas une date')).toThrow(TypeError)
  })
})

describe('useDate — distance en jours', () => {
  it('compte en jours pleins, sans se laisser piéger par les heures', () => {
    // Une cotisation due « demain » l'est encore à 23 h 59 : la comparaison
    // porte sur le jour, pas sur l'instant.
    expect(daysUntil(new Date(2026, 7, 28, 0, 1), REFERENCE)).toBe(1)
    expect(daysUntil(new Date(2026, 7, 27, 23, 59), REFERENCE)).toBe(0)
    expect(daysUntil(new Date(2026, 7, 26, 0, 1), REFERENCE)).toBe(-1)
  })

  it('dit le retard en toutes lettres, pas seulement par une couleur', () => {
    expect(formatRelativeDay(new Date(2026, 7, 27), REFERENCE)).toBe('aujourd’hui')
    expect(formatRelativeDay(new Date(2026, 7, 28), REFERENCE)).toBe('demain')
    expect(formatRelativeDay(new Date(2026, 7, 26), REFERENCE)).toBe('hier')
    expect(formatRelativeDay(new Date(2026, 7, 30), REFERENCE)).toBe('dans 3 jours')
    expect(formatRelativeDay(new Date(2026, 7, 25), REFERENCE)).toBe('en retard de 2 jours')
  })

  it('traverse correctement un changement de mois', () => {
    expect(daysUntil(new Date(2026, 8, 2), REFERENCE)).toBe(6)
    expect(formatRelativeDay(new Date(2026, 8, 2), REFERENCE)).toBe('dans 6 jours')
  })

  it('sait si une date est passée', () => {
    expect(isPast(new Date(2026, 7, 26), REFERENCE)).toBe(true)
    expect(isPast(new Date(2026, 7, 27), REFERENCE)).toBe(false)
    expect(isPast(new Date(2026, 7, 28), REFERENCE)).toBe(false)
  })
})
