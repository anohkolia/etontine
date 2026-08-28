import { expect, test } from '@playwright/test'
import { waitForHydration } from './helpers/hydration'
import { canalVerifie, seConnecter, verifierIdentite } from './helpers/session'
import { numeroDeTest } from './helpers/telephone'

async function tontineLancee(page: import('@playwright/test').Page) {
  await seConnecter(page)
  await verifierIdentite(page)
  const canal = await canalVerifie(page, `+225${numeroDeTest()}`)

  const creation = await page.request.post('/api/v1/tontines', {
    data: { name: 'Tontine des tantines', access: 'private' },
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

test('déclarer sans réseau, puis retrouver la déclaration synchronisée', async ({ page, context }) => {
  const id = await tontineLancee(page)
  await page.goto(`/app/tontine/${id}/cotiser`)
  await waitForHydration(page)

  await page.locator('[data-testid^="bouton-envoyer-"]').first().click()
  await page.getByTestId('bouton-jai-envoye').click()

  // Le tramway, le sous-sol, la zone blanche.
  await context.setOffline(true)
  await expect(page.getByTestId('offline-banner')).toBeVisible()

  await page.getByTestId('bouton-declarer').click()

  // Acceptation T24 : la saisie n'est pas perdue, et l'application le dit
  // clairement plutôt que de laisser croire que c'est passé.
  await expect(page.getByTestId('message-declaration')).toContainText('partira toute seule')
  await expect(page.getByTestId('file-en-attente')).toContainText('1 envoi')

  // Le réseau revient : la file part toute seule, sans geste du membre.
  await context.setOffline(false)
  await expect(page.getByTestId('offline-banner')).toBeHidden()
  await expect(page.getByTestId('file-en-attente')).toBeHidden({ timeout: 15_000 })

  // Et la déclaration est bien arrivée côté serveur.
  await page.reload()
  await waitForHydration(page)
  await expect(page.getByTestId('liste-cotisations')).toContainText('Déclaré')
})

test('la file ne déclare pas deux fois, même vidée plusieurs fois', async ({ page, context }) => {
  const id = await tontineLancee(page)
  await page.goto(`/app/tontine/${id}/cotiser`)
  await waitForHydration(page)
  await page.locator('[data-testid^="bouton-envoyer-"]').first().click()
  await page.getByTestId('bouton-jai-envoye').click()

  await context.setOffline(true)
  await page.getByTestId('bouton-declarer').click()
  await expect(page.getByTestId('file-en-attente')).toBeVisible()

  await context.setOffline(false)
  await expect(page.getByTestId('file-en-attente')).toBeHidden({ timeout: 15_000 })

  // La clé d'idempotence voyage avec l'intention : même si la file repartait,
  // le serveur ne créerait pas de seconde déclaration.
  const file = await page.request.get(`/api/v1/tontines/${id}/pending-confirmations`)
  const { items } = await file.json() as { items: unknown[] }
  expect(items).toHaveLength(1)
})

test('aucune saisie n’est perdue si l’on quitte la page hors ligne', async ({ page, context }) => {
  const id = await tontineLancee(page)
  await page.goto(`/app/tontine/${id}/cotiser`)
  await waitForHydration(page)
  await page.locator('[data-testid^="bouton-envoyer-"]').first().click()
  await page.getByTestId('bouton-jai-envoye').click()

  await context.setOffline(true)
  await page.getByTestId('bouton-declarer').click()
  await expect(page.getByTestId('file-en-attente')).toBeVisible()

  // On quitte l'écran, toujours sans réseau : la file survit dans IndexedDB.
  await page.goto('/app', { waitUntil: 'commit' }).catch(() => {})
  await context.setOffline(false)
  await page.goto('/app')
  await waitForHydration(page)

  // Elle est partie au retour du réseau, sans intervention.
  await expect(page.getByTestId('file-en-attente')).toBeHidden({ timeout: 15_000 })
  const file = await page.request.get(`/api/v1/tontines/${id}/pending-confirmations`)
  const { items } = await file.json() as { items: unknown[] }
  expect(items).toHaveLength(1)
})

test('la page d’aide reste consultable et répond aux questions d’argent', async ({ page }) => {
  await page.goto('/aide')
  await waitForHydration(page)

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Aide')
  // Règle 5 : l'application ne détient jamais de fonds, et l'aide le dit.
  await expect(page.locator('body')).toContainText('L’application garde-t-elle mon argent ?')
  await expect(page.locator('body')).toContainText('Non, jamais')
  await expect(page.locator('body')).toContainText('déclaré')
  await expect(page.locator('body')).toContainText('confirmé')
})
