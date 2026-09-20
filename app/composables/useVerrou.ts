/**
 * Le verrou d'écran.
 *
 * Le code d'accès — celui qui ouvre la session — est redemandé à l'écran :
 * la session tient au cookie, mais un téléphone prêté cinq minutes ne doit
 * pas suffire à lire le registre.
 *
 * Deux moments verrouillent : l'ouverture de l'application, et le retour
 * après cinq minutes en arrière-plan. L'état vit dans `sessionStorage` — un
 * onglet fermé est un onglet verrouillé — et jamais dans le magasin persisté :
 * il n'a rien à faire dans `localStorage`, où il survivrait à la fermeture.
 *
 * Une connexion, une confirmation d'e-mail ou une réinitialisation
 * déverrouillent : le code vient d'être saisi ou choisi.
 */
const CLE = 'etontine-verrou'
export const RELOCK_APRES_MS = 5 * 60 * 1000

function lireStockage(): number | null {
  try {
    const brut = sessionStorage.getItem(CLE)
    return brut ? Number(brut) : null
  }
  catch {
    return null
  }
}

function ecrireStockage(valeur: number | null) {
  try {
    if (valeur === null) sessionStorage.removeItem(CLE)
    else sessionStorage.setItem(CLE, String(valeur))
  }
  catch {
    // Stockage indisponible (navigation privée stricte) : le verrou vaudra pour
    // la seule vie de la page. C'est le comportement le plus sûr.
  }
}

export function useVerrou() {
  // `useState` et non un `ref` de module : l'état ne doit pas fuir d'une
  // requête à l'autre côté serveur.
  const deverrouilleDepuis = useState<number | null>('verrou-deverrouille-depuis', () => null)
  const cacheDepuis = useState<number | null>('verrou-cache-depuis', () => null)

  /** Relit le stockage : à l'ouverture, l'état vient de l'onglet, pas de la mémoire. */
  function rafraichir() {
    if (typeof window === 'undefined') return
    deverrouilleDepuis.value = lireStockage()
  }

  const deverrouille = computed(() => deverrouilleDepuis.value !== null)

  function deverrouiller() {
    const maintenant = Date.now()
    deverrouilleDepuis.value = maintenant
    ecrireStockage(maintenant)
  }

  function verrouiller() {
    deverrouilleDepuis.value = null
    ecrireStockage(null)
  }

  /**
   * Reverrouille après un long passage en arrière-plan. À brancher une fois,
   * dans la mise en page de l'application.
   */
  function surveiller() {
    if (typeof document === 'undefined') return
    const onVisibilite = () => {
      if (document.visibilityState === 'hidden') {
        cacheDepuis.value = Date.now()
        return
      }
      if (cacheDepuis.value !== null && Date.now() - cacheDepuis.value >= RELOCK_APRES_MS) {
        verrouiller()
        const route = useRoute()
        if (route.path.startsWith('/app') && route.path !== '/app/verrou') {
          navigateTo({ path: '/app/verrou', query: { redirect: route.fullPath } })
        }
      }
      cacheDepuis.value = null
    }
    document.addEventListener('visibilitychange', onVisibilite)
    onBeforeUnmount(() => document.removeEventListener('visibilitychange', onVisibilite))
  }

  return { deverrouille, rafraichir, deverrouiller, verrouiller, surveiller }
}
