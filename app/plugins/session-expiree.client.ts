/**
 * Session expirée : une seule réponse, partout.
 *
 * La session tient au cookie, trente jours glissants ; elle peut aussi être
 * coupée par une déconnexion sur un autre appareil. Jusqu'ici, chaque écran
 * recevait alors un `401` et affichait « Impossible de joindre le serveur » —
 * faux, et sans issue : le magasin de session gardait l'utilisateur en cache,
 * le middleware ne revérifiait rien, et il fallait deviner qu'il fallait
 * recharger la page.
 *
 * Ici, tout `401` de l'API vide le cache et renvoie à la connexion, en gardant
 * l'intention dans `?redirect=`. Les routes d'authentification sont exclues :
 * un mauvais code SMS est un `401` légitime qui se traite sur place.
 *
 * L'interception se fait sur `fetch` lui-même, pas sur `$fetch` : l'import
 * automatique `$fetch` est une liaison de module figée au chargement, la
 * remplacer après coup ne toucherait aucun écran. `ofetch` résout
 * `globalThis.fetch` à chaque appel — c'est le seul point commun à tous.
 */
export default defineNuxtPlugin(() => {
  const fetchOriginal = globalThis.fetch.bind(globalThis)

  globalThis.fetch = async (entree, init) => {
    const reponse = await fetchOriginal(entree, init)
    if (reponse.status !== 401) return reponse

    const brut = typeof entree === 'string' ? entree : entree instanceof URL ? entree.href : entree.url
    const chemin = new URL(brut, window.location.origin).pathname
    if (!chemin.startsWith('/api/v1/') || chemin.startsWith('/api/v1/auth/')) return reponse

    const session = useSessionStore()
    // Déjà déconnecté côté client : rien à faire, et surtout pas une boucle.
    if (session.connecte) {
      session.expirer()
      const route = useRoute()
      if (!route.path.startsWith('/login')) {
        navigateTo({ path: '/login', query: { redirect: route.fullPath, motif: 'expiree' } })
      }
    }

    return reponse
  }
})
