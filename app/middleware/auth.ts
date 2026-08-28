/**
 * Exige une session ouverte.
 *
 * La redirection conserve l'intention initiale dans `?redirect=` : quelqu'un
 * qui ouvre un lien de cotisation reçu par WhatsApp doit atterrir sur cette
 * cotisation après connexion, pas sur un tableau de bord générique.
 */
export default defineNuxtRouteMiddleware(async (to) => {
  const session = useSessionStore()
  await session.charger()

  if (!session.connecte) {
    return navigateTo({ path: '/login', query: { redirect: to.fullPath } })
  }
})
