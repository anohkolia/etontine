/**
 * Toute page exige une session d'administration, sauf l'écran de connexion.
 *
 * Middleware **global** et non déclaré page par page : sur un back-office, une
 * page ajoutée sans sa garde est une fuite. Ici l'oubli n'est pas possible —
 * il faut au contraire déclarer explicitement qu'une page est publique.
 *
 * Ce n'est qu'un confort d'interface : chaque route serveur revérifie la liste
 * blanche de son côté. Masquer un écran n'a jamais protégé une donnée.
 */
export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path === '/') return

  const admin = useAdminSession()
  await admin.charger()

  if (!admin.connecte.value) return navigateTo('/')
})
