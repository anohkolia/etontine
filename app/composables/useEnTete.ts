/**
 * Titre, sous-titre et lien de retour de l'en-tête de l'application.
 *
 * L'en-tête vit dans `layouts/app.vue` — il est collant et porte le dégradé —
 * mais son contenu appartient à la page. Plutôt qu'un `<template #entete>` que
 * chaque page devrait recopier, la page déclare ce qu'elle veut afficher et le
 * gabarit le rend.
 *
 * Repris de `AppShell` du template, où titre, sous-titre et retour sont des
 * propriétés du composant d'enveloppe.
 *
 * @example
 * ```ts
 * useEnTete(() => ({
 *   titre: tontine.value?.name ?? 'Tontine',
 *   sousTitre: 'Cotisations du tour en cours',
 *   retour: { to: '/app', label: 'Mes tontines' },
 * }))
 * ```
 */
export interface EnTete {
  titre: string
  sousTitre?: string
  /** Lien de retour affiché au-dessus du titre. Omis, aucun lien n'est rendu. */
  retour?: { to: string, label: string }
}

const DEFAUT: EnTete = { titre: 'eTontine' }

/**
 * Sans argument, renvoie l'en-tête courant — c'est ce que fait le gabarit.
 * Avec un argument, la page le déclare, et il suit ses valeurs réactives.
 */
export function useEnTete(valeur?: () => EnTete) {
  // `useState` et non un `ref` de module : l'état ne doit pas fuir d'une
  // requête à l'autre côté serveur, même si `/app/**` est rendu en SPA.
  const etat = useState<EnTete>('en-tete', () => ({ ...DEFAUT }))

  if (valeur) {
    watchEffect(() => {
      etat.value = valeur()
    })
  }

  return etat
}
