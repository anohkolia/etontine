import type { frequency } from '#shared/schemas'
import type { z } from 'zod'
// Import explicite plutôt que l'auto-import de Nuxt : ce composable est aussi
// chargé par les tests unitaires, hors du contexte applicatif où l'auto-import
// existe. Sans cela, `pnpm typecheck` échoue sur la seconde passe.
import { useMoney } from './useMoney'

type Frequence = z.infer<typeof frequency>

const PERIODE: Record<Frequence, { singulier: string, pluriel: string }> = {
  daily: { singulier: 'jour', pluriel: 'jours' },
  weekly: { singulier: 'semaine', pluriel: 'semaines' },
  biweekly: { singulier: 'quinzaine', pluriel: 'quinzaines' },
  monthly: { singulier: 'mois', pluriel: 'mois' },
}

/**
 * Simulateur du wizard : « 12 × 10 000 FCFA = 120 000 FCFA par tour, sur 12 mois ».
 *
 * Un organisateur doit voir la conséquence de ses réglages **avant** de valider.
 * Beaucoup découvrent au troisième tour que le pot dépasse ce que leur compte
 * de monnaie électronique peut recevoir — trop tard, la tontine est lancée.
 *
 * Ce calcul est une **projection d'aide à la saisie**, pas un montant qui
 * engage : le pot réel est calculé côté serveur à partir des parts réellement
 * attribuées (règle 2). Tant qu'aucun membre n'a rejoint, il n'existe pas.
 */
export function useSimulateur() {
  const { format } = useMoney()

  function potParTour(montantPart: number, nombreDeParts: number): number {
    return montantPart * nombreDeParts
  }

  /** « sur 12 mois » — la durée d'un cycle complet, un tour par part. */
  function duree(nombreDeParts: number, frequence: Frequence): string {
    const mot = nombreDeParts > 1 ? PERIODE[frequence].pluriel : PERIODE[frequence].singulier
    return `${nombreDeParts} ${mot}`
  }

  function phrase(montantPart: number, nombreDeParts: number, frequence: Frequence): string {
    if (montantPart <= 0 || nombreDeParts <= 0) return ''

    const pot = potParTour(montantPart, nombreDeParts)
    return `${nombreDeParts} × ${format(montantPart)} = ${format(pot)} par tour, `
      + `sur ${duree(nombreDeParts, frequence)}.`
  }

  /** Ce que chaque part aura versé sur le cycle — et donc reçu à son tour. */
  function totalEngage(montantPart: number, nombreDeParts: number): number {
    return montantPart * nombreDeParts
  }

  return { potParTour, duree, phrase, totalEngage }
}
