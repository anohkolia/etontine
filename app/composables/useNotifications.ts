/**
 * Le compteur de notifications non lues, partagé par l'en-tête et l'écran.
 *
 * `useState` et non un `ref` de module : l'état ne doit pas fuir d'une requête
 * à l'autre côté serveur, même si `/app/**` est rendu en SPA.
 */
export function useNotifications() {
  const nonLues = useState<number>('notifications-non-lues', () => 0)

  async function rafraichirCompteur() {
    try {
      // `limit=1` : on ne vient chercher que le compteur, qui porte sur tout.
      const { unread } = await $fetch<{ unread: number }>('/api/v1/me/notifications?limit=1')
      nonLues.value = unread
    }
    catch {
      // Le compteur est un confort : une coupure réseau ne doit pas casser
      // l'en-tête de toute l'application authentifiée.
    }
  }

  return { nonLues, rafraichirCompteur }
}
