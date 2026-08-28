import type { Page } from '@playwright/test'

/**
 * Attend que Vue ait pris la main sur le HTML rendu côté serveur.
 *
 * Sans cette attente, un clic peut atterrir sur le balisage SSR avant que les
 * écouteurs soient posés : Playwright voit bien le bouton, le clic part, et il
 * est simplement perdu. Le symptôme est un test rouge par intermittence, plus
 * fréquent sur le premier chargement en développement (compilation à la volée).
 *
 * Vue pose `__vue_app__` sur le conteneur de montage à la fin de l'hydratation :
 * c'est le marqueur le plus fiable, et il ne dépend d'aucun détail interne de Nuxt.
 */
export async function waitForHydration(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const root = document.querySelector('#__nuxt') as (Element & { __vue_app__?: unknown }) | null
    return Boolean(root?.__vue_app__)
  })
}
