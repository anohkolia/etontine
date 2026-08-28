import { expect, test } from '@playwright/test'
import { waitForHydration } from './helpers/hydration'
import { canalVerifie, seConnecter, verifierIdentite } from './helpers/session'
import { numeroDeTest } from './helpers/telephone'

/** Monte une tontine lancée où l'utilisateur a une cotisation à verser. */
async function tontineLancee(page: import('@playwright/test').Page) {
  await seConnecter(page)
  await verifierIdentite(page)
  const canal = await canalVerifie(page, `+225${numeroDeTest()}`)

  const creation = await page.request.post('/api/v1/tontines', {
    data: { name: 'Tontine des tantines', locality: 'Abobo', access: 'private' },
  })
  const { id } = await creation.json() as { id: string }

  await page.request.fetch(`/api/v1/tontines/${id}`, {
    method: 'PATCH',
    data: {
      shareAmount: 25_000,
      frequency: 'monthly',
      startDate: new Date().toISOString().slice(0, 10),
      collectionChannelIds: [canal],
    },
  })
  for (const nom of ['Koffi N’Guessan', 'Fatou Diarra']) {
    await page.request.post(`/api/v1/tontines/${id}/members`, {
      data: { name: nom, phone: `+225${numeroDeTest()}`, shares: 1 },
    })
  }
  await page.request.post(`/api/v1/tontines/${id}/publish`)
  await page.request.post(`/api/v1/tontines/${id}/start`)
  return id
}

test('un seul appel de données peint l’écran', async ({ page }) => {
  await tontineLancee(page)

  const appels: string[] = []
  page.on('request', (requete) => {
    const chemin = new URL(requete.url()).pathname
    // `/auth/me` est l'amorçage de session, partagé par toute l'application et
    // mis en cache dans le magasin : il ne fait pas partie des données de
    // l'écran. C'est la multiplication des appels **par tontine** que
    // l'acceptation vise à interdire.
    if (chemin.startsWith('/api/v1/') && chemin !== '/api/v1/auth/me') appels.push(chemin)
  })

  await page.goto('/app')
  await waitForHydration(page)
  await expect(page.getByTestId('liste-tontines')).toBeVisible()

  expect(appels).toEqual(['/api/v1/dashboard'])
})

test('le bloc « à traiter aujourd’hui » vient en premier', async ({ page }) => {
  await tontineLancee(page)
  await page.goto('/app')
  await waitForHydration(page)

  const bloc = page.getByTestId('bloc-a-traiter')
  await expect(bloc).toBeVisible()
  await expect(bloc).toContainText('cotisation')

  // Il précède la liste des tontines dans l'ordre du document : un membre
  // ouvre l'application pour savoir quoi faire, pas pour consulter.
  const positionBloc = await bloc.evaluate(el => el.compareDocumentPosition(
    document.querySelector('[data-testid="liste-tontines"]')!,
  ))
  // DOCUMENT_POSITION_FOLLOWING vaut 4 : la liste suit bien le bloc.
  expect(positionBloc & 4).toBe(4)
})

test('aucun DataTable n’est rendu à 360 px', async ({ page }) => {
  await tontineLancee(page)
  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto('/app')
  await waitForHydration(page)

  // Règle 11 : liste de cartes empilées sous `md`. Un tableau à six colonnes
  // est illisible sur un téléphone tenu d'une main.
  await expect(page.locator('[data-pc-name="datatable"]')).toHaveCount(0)
  await expect(page.locator('table')).toHaveCount(0)
  await expect(page.getByTestId('liste-tontines')).toBeVisible()
})

test('la jauge et le montant dû s’affichent sur la carte', async ({ page }) => {
  const id = await tontineLancee(page)
  await page.goto('/app')
  await waitForHydration(page)

  const carte = page.getByTestId(`carte-tontine-${id}`)
  await expect(carte).toContainText('Tontine des tantines')
  await expect(carte).toContainText('Tour 1')
  await expect(carte.locator('[data-pc-name="progressbar"]')).toBeVisible()

  // Le président a une part : il doit 25 000 FCFA.
  await expect(carte).toContainText('25 000 FCFA')
  await expect(carte.getByTestId('status-badge').first()).toBeVisible()
})

test('les actions rapides mènent aux bons écrans', async ({ page }) => {
  const id = await tontineLancee(page)
  await page.goto('/app')
  await waitForHydration(page)

  await page.getByTestId(`action-cotiser-${id}`).click()
  await page.waitForURL(new RegExp(`/app/tontine/${id}/cotiser`))
})
