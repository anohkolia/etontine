import {
  FCFA, formatAmount, formatMoney, formatMoneyOrDash,
} from '#shared/format/money'

export { FCFA }

/**
 * Formatage des montants côté interface.
 *
 * L'implémentation vit dans `shared/format/money.ts`, partagée avec le serveur :
 * le même montant doit s'écrire à l'identique à l'écran, sur un reçu (T18) et
 * dans le procès-verbal PDF (T20). Ce composable n'est qu'un point d'accès
 * commode, pour que les composants n'aient pas à connaître le chemin.
 *
 * ESLint interdit `toLocaleString` dans un composant : `useMoney()` est le seul
 * point de formatage autorisé.
 */
export function useMoney() {
  return {
    /** `25000` → `25 000 FCFA`. Lève si le montant n'est pas entier. */
    format: formatMoney,
    /** Le nombre seul, groupé, sans la devise. */
    formatAmount,
    /** `null` → `—`. Zéro reste `0 FCFA`. */
    formatOrDash: formatMoneyOrDash,
    FCFA,
  }
}
