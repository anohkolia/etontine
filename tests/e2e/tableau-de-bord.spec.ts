import { expect, test } from '@playwright/test'
import { waitForHydration } from './helpers/hydration'
import { canalDeclare, seConnecter, verifierIdentite } from './helpers/session'
import { numeroDeTest } from './helpers/telephone'
import { tontineLanceeAvecCotisant } from './helpers/tontine'

/** Monte une tontine lancée, vue par son président — qui ne cotise pas. */
async function tontineLancee(page: import('@playwright/test').Page) {
  await seConnecter(page)
  await verifierIdentite(page)
  const canal = await canalDeclare(page, `+225${numeroDeTest()}`)

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
    // Deux appels appartiennent à la **coquille**, pas à l'écran : `/auth/me`,
    // l'amorçage de session mis en cache dans le magasin, et le compteur de
    // notifications, que la cloche de l'en-tête affiche sur toutes les pages
    // authentifiées. Ni l'un ni l'autre ne se multiplie par tontine — et c'est
    // cette multiplication-là que l'acceptation vise à interdire.
    const coquille = ['/api/v1/auth/me', '/api/v1/me/notifications']
    if (chemin.startsWith('/api/v1/') && !coquille.includes(chemin)) appels.push(chemin)
  })

  await page.goto('/app')
  await waitForHydration(page)
  await expect(page.getByTestId('liste-tontines')).toBeVisible()

  expect(appels).toEqual(['/api/v1/dashboard'])
})

test('le bloc « à traiter aujourd’hui » vient en premier', async ({ page, browser }) => {
  // Vu par Koffi, qui a une cotisation à verser. Le président ne cotise pas :
  // son bloc, lui, ne se remplit que des décisions qu'on attend de lui.
  await tontineLanceeAvecCotisant(browser, page)
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

test('la jauge et le montant dû s’affichent sur la carte', async ({ page, browser }) => {
  const { id } = await tontineLanceeAvecCotisant(browser, page)
  await page.goto('/app')
  await waitForHydration(page)

  const carte = page.getByTestId(`carte-tontine-${id}`)
  await expect(carte).toContainText('Tontine des tantines')
  await expect(carte).toContainText('Tour 1')
  await expect(carte.locator('[data-pc-name="progressbar"]')).toBeVisible()

  // Koffi a une part : il doit 25 000 FCFA.
  await expect(carte).toContainText('25 000 FCFA')
  await expect(carte.getByTestId('status-badge').first()).toBeVisible()
})

test('les actions rapides mènent aux bons écrans', async ({ page, browser }) => {
  const { id } = await tontineLanceeAvecCotisant(browser, page)
  await page.goto('/app')
  await waitForHydration(page)

  await page.getByTestId(`action-cotiser-${id}`).click()
  await page.waitForURL(new RegExp(`/app/tontine/${id}/cotiser`))
})
