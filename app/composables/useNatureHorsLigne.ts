/**
 * Ce que le bandeau hors-ligne peut honnêtement promettre sur l'écran courant.
 *
 * Le bandeau est rendu par `layouts/app.vue`, mais la vérité qu'il énonce
 * appartient à la page : seule elle sait si sa saisie passe par la file de
 * mutations. Même mécanique que `useEnTete()` — la page déclare, le gabarit
 * rend — et pour la même raison : un `<template #bandeau>` que chaque page
 * recopierait serait oublié quelque part.
 *
 * **Le défaut est le plus prudent.** `envoyerOuEnfiler` ne couvre aujourd'hui
 * qu'un seul écran ; partout ailleurs une saisie faite sans réseau est perdue.
 * Promettre par défaut qu'elle est gardée, c'est faire attendre à quelqu'un un
 * envoi qui n'a jamais eu lieu — l'écran qui tient la promesse la réclame.
 *
 * @example
 * ```ts
 * // Sur un écran couvert par la file de mutations :
 * useNatureHorsLigne(() => 'saisie')
 * ```
 */
export type NatureHorsLigne = 'saisie' | 'lecture' | 'reseau-requis'

const DEFAUT: NatureHorsLigne = 'reseau-requis'

export function useNatureHorsLigne(valeur?: () => NatureHorsLigne) {
  // `useState` et non un `ref` de module : l'état ne doit pas fuir d'une
  // requête à l'autre côté serveur, même si `/app/**` est rendu en SPA.
  const etat = useState<NatureHorsLigne>('nature-hors-ligne', () => DEFAUT)

  if (valeur) {
    watchEffect(() => {
      etat.value = valeur()
    })

    // Le retour au défaut à la sortie de la page est ce qui rend le mécanisme
    // sûr. Sans lui, quitter l'écran de cotisation pour un autre garderait sa
    // promesse affichée — et l'on aurait reconstruit le bug qu'on corrige.
    onScopeDispose(() => {
      etat.value = DEFAUT
    })
  }

  return etat
}
