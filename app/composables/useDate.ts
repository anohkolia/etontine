const MOIS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
] as const

const JOURS = [
  'dimanche', 'lundi', 'mardi', 'mercredi',
  'jeudi', 'vendredi', 'samedi',
] as const

const MS_PAR_JOUR = 86_400_000

/**
 * Dates et délais.
 *
 * Comme `useMoney()`, le formatage est manuel plutôt que délégué à `Intl` : le
 * rendu doit être le même sur tous les appareils et dans les documents générés
 * côté serveur (T20).
 *
 * Le vocabulaire suit la règle 9 : on parle de **tour** et de date de
 * cotisation, jamais d'« échéance ».
 */
export function useDate() {
  /** `2026-08-27` → `27 août 2026`. */
  function formatDate(value: Date | string): string {
    const d = toDate(value)
    return `${d.getDate()} ${MOIS[d.getMonth()]} ${d.getFullYear()}`
  }

  /** `2026-08-27` → `jeudi 27 août`. Pour une date proche, où l'année encombre. */
  function formatDayAndDate(value: Date | string): string {
    const d = toDate(value)
    return `${JOURS[d.getDay()]} ${d.getDate()} ${MOIS[d.getMonth()]}`
  }

  /**
   * Distance en jours pleins, du jour de `from` au jour de `value`. Les heures
   * sont ignorées : une cotisation due « demain » l'est encore à 23 h 59.
   */
  function daysUntil(value: Date | string, from: Date = new Date()): number {
    const a = startOfDay(toDate(value))
    const b = startOfDay(from)
    return Math.round((a.getTime() - b.getTime()) / MS_PAR_JOUR)
  }

  /**
   * Formulation relative d'une date de cotisation : « aujourd'hui »,
   * « demain », « dans 3 jours », « en retard de 2 jours ».
   *
   * Le retard est dit en toutes lettres, pas seulement signalé par une
   * couleur — règle 10.
   */
  function formatRelativeDay(value: Date | string, from: Date = new Date()): string {
    const days = daysUntil(value, from)

    if (days === 0) return 'aujourd’hui'
    if (days === 1) return 'demain'
    if (days === -1) return 'hier'
    if (days > 1) return `dans ${days} jours`
    return `en retard de ${Math.abs(days)} jours`
  }

  /** Vrai si la date est passée, au jour près. */
  function isPast(value: Date | string, from: Date = new Date()): boolean {
    return daysUntil(value, from) < 0
  }

  return { formatDate, formatDayAndDate, formatRelativeDay, daysUntil, isPast }
}

function toDate(value: Date | string): Date {
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) {
    throw new TypeError(`Date invalide : ${String(value)}`)
  }
  return d
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}
