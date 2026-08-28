/**
 * Vérifie le palier KYC exigé par la page, déclaré dans `definePageMeta`.
 *
 * Redirige vers la complétion du palier manquant **en conservant l'intention
 * initiale** (docs/data-model.md §4) : sans le `?redirect=`, on renvoie le
 * membre au point de départ après lui avoir demandé ses papiers, et il
 * abandonne.
 */
export default defineNuxtRouteMiddleware(async (to) => {
  const requis = Number(to.meta.kycLevel ?? 0)
  if (requis === 0) return

  const session = useSessionStore()
  await session.charger()

  const actuel = session.user?.kycLevel ?? 0
  if (actuel >= requis) return

  return navigateTo({
    path: requis >= 2 ? '/app/profil/identite' : '/app/profil',
    query: { redirect: to.fullPath, palier: String(requis) },
  })
})
