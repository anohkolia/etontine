/**
 * Espace fine insécable (U+202F) — le séparateur de milliers imposé par la
 * règle 7 de CLAUDE.md.
 */
export const NARROW_NBSP = ' '

/** Espace insécable (U+00A0), entre le nombre et la devise. */
export const NBSP = ' '

export const FCFA = 'FCFA'

/**
 * Formatage des montants — **partagé client et serveur**.
 *
 * Placé dans `shared/` et non dans un composable : le même montant doit
 * s'écrire à l'identique dans l'interface, dans un reçu fabriqué côté serveur
 * (T18) et dans le procès-verbal PDF (T20). Une seconde implémentation, même
 * fidèle au départ, finirait par diverger sur un cas limite — et deux montants
 * différents pour la même somme dans deux documents d'une même tontine, c'est
 * exactement ce qui déclenche une dispute.
 *
 * Trois raisons de ne pas passer par `Intl.NumberFormat` :
 *
 * 1. Le séparateur de milliers de `fr-FR` dépend de la version d'ICU. Selon
 *    l'appareil, `Intl` rend une espace ordinaire, une insécable ou une fine
 *    insécable — trois rendus pour un même montant, sur un parc dominé par des
 *    Android anciens.
 * 2. La règle 6 interdit les flottants. Un formateur qui arrondit silencieusement
 *    `25000.5` masque un bug de calcul en amont.
 * 3. Le rendu doit être identique côté serveur et côté client.
 */
export function formatAmount(amount: number): string {
  assertInteger(amount)

  const negatif = amount < 0
  const groupe = Math.abs(amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, NARROW_NBSP)

  // U+2212, le vrai signe moins, et non le trait d'union : un manquant au
  // registre doit se lire sans ambiguïté.
  return negatif ? `−${groupe}` : groupe
}

/** `25000` → `25 000 FCFA`. */
export function formatMoney(amount: number): string {
  return `${formatAmount(amount)}${NBSP}${FCFA}`
}

/**
 * Comme `formatMoney`, mais rend un tiret pour une valeur absente. Zéro est une
 * information ; l'absence de valeur en est une autre.
 */
export function formatMoneyOrDash(amount: number | null | undefined): string {
  return amount === null || amount === undefined ? '—' : formatMoney(amount)
}

export function assertInteger(amount: number): void {
  if (!Number.isInteger(amount)) {
    throw new TypeError(
      `Montant non entier : ${amount}. Les montants sont en FCFA entiers, `
      + 'sans centimes (CLAUDE.md, règle 6). Un décimal ici vient d’un calcul '
      + 'fautif en amont — le corriger plutôt que l’arrondir à l’affichage.',
    )
  }
}
