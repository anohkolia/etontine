/**
 * Verrou d'écran : quand un code est défini, l'application ne s'ouvre pas sans lui.
 *
 * Global plutôt que déclaré page par page : oublier le middleware sur un seul
 * écran de `/app/**` ferait un trou dans le verrou, et c'est exactement le
 * genre d'oubli qu'on ne voit pas. Les pages publiques ne sont pas concernées
 * — un reçu vérifiable ou une invitation n'a rien à cacher.
 *
 * Le verrou est un état d'affichage : le serveur n'en sait rien, la session
 * reste valide. C'est voulu — voir `useVerrou()`.
 */
export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return
  if (!to.path.startsWith('/app') || to.path === '/app/verrou') return

  const session = useSessionStore()
  await session.charger()
  if (!session.user?.hasPin) return

  const verrou = useVerrou()
  verrou.rafraichir()
  if (verrou.deverrouille.value) return

  return navigateTo({ path: '/app/verrou', query: { redirect: to.fullPath } })
})
