/**
 * État de la connexion réseau, pour `<OfflineBanner>` et la file de mutations
 * hors-ligne (T24).
 *
 * Écrit à la main plutôt qu'emprunté à une bibliothèque d'utilitaires : c'est
 * une quinzaine de lignes, et chaque dépendance client coûte du budget de
 * poids (CLAUDE.md, § Performance).
 *
 * Le rendu serveur suppose la connexion présente : sur la landing pré-rendue,
 * afficher un bandeau « hors ligne » dans le HTML statique serait un contresens.
 */
export function useOnline() {
  const online = useState('reseau-en-ligne', () => true)

  onMounted(() => {
    online.value = navigator.onLine

    const monter = () => (online.value = true)
    const descendre = () => (online.value = false)

    window.addEventListener('online', monter)
    window.addEventListener('offline', descendre)

    onBeforeUnmount(() => {
      window.removeEventListener('online', monter)
      window.removeEventListener('offline', descendre)
    })
  })

  return online
}
