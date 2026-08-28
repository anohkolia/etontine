import type { frequency } from '#shared/schemas'
import type { z } from 'zod'
import { useMoney } from './useMoney'

type Frequence = z.infer<typeof frequency>

/** Comment se dit la périodicité dans la phrase d'engagement. */
const CADENCE: Record<Frequence, string> = {
  daily: 'chaque jour',
  weekly: 'chaque semaine',
  biweekly: 'tous les quinze jours',
  monthly: 'chaque mois',
}

const UNITE: Record<Frequence, { singulier: string, pluriel: string }> = {
  daily: { singulier: 'jour', pluriel: 'jours' },
  weekly: { singulier: 'semaine', pluriel: 'semaines' },
  biweekly: { singulier: 'quinzaine', pluriel: 'quinzaines' },
  monthly: { singulier: 'mois', pluriel: 'mois' },
}

/**
 * Phrase d'engagement affichée avant d'accepter une invitation.
 *
 * « Tu t'engages à verser X chaque mois pendant N mois, soit Y au total. Tu
 * recevras Y à ton tour. »
 *
 * Elle est **générée à partir des réglages réels**, jamais rédigée à la main :
 * c'est le seul endroit où l'on dit à quelqu'un ce qu'il signe. Une tontine se
 * rejoint souvent sur la parole d'un proche, sans avoir fait le calcul ; voir
 * le total avant de dire oui évite l'abandon au troisième tour, qui est ce qui
 * casse une tontine.
 *
 * Le tutoiement est délibéré : c'est le registre de l'application, et une
 * tontine se joue entre gens qui se connaissent.
 */
export function useEngagement() {
  const { format } = useMoney()

  function total(montantPart: number, nombreDeTours: number): number {
    return montantPart * nombreDeTours
  }

  function phrase(montantPart: number, nombreDeTours: number, frequence: Frequence): string {
    if (montantPart <= 0 || nombreDeTours <= 0) return ''

    const cumul = total(montantPart, nombreDeTours)
    const unite = nombreDeTours > 1 ? UNITE[frequence].pluriel : UNITE[frequence].singulier

    return `Tu t’engages à verser ${format(montantPart)} ${CADENCE[frequence]} `
      + `pendant ${nombreDeTours} ${unite}, soit ${format(cumul)} au total. `
      + `Tu recevras ${format(cumul)} à ton tour.`
  }

  return { phrase, total }
}
