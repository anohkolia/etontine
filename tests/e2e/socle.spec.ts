import { expect, test } from '@playwright/test'
import { waitForHydration } from './helpers/hydration'
import { renseignerNom, seConnecter } from './helpers/session'

/**
 * Fumigation du socle : la landing publique, pré-rendue. Les huit composants
 * du socle sont couverts par `demo.spec.ts` ; les quatre parcours critiques
 * (inscription OTP, rejoindre par lien, cotiser, verser) sont le ticket T26.
 */
test('la landing publique se charge', async ({ page }) => {
  await page.goto('/')

  // Le `<h1>` porte la promesse, pas la marque : c'est ce que lit un moteur de
  // recherche comme un lecteur d'écran qui saute de titre en titre. Le nom
  // reste visible dans la barre de navigation de l'en-tête.
  await expect(page.getByRole('heading', { level: 1 }))
    .toHaveText('La tontine de votre groupe, tenue au clair.')
  await expect(page.getByTestId('lien-connexion')).toBeVisible()
})

test('l’onglet « Aide » garde la barre d’onglets', async ({ page }) => {
  await seConnecter(page)
  await renseignerNom(page)

  await page.goto('/app')
  await waitForHydration(page)
  await page.getByTestId('onglet-aide').click()
  await page.waitForURL(url => url.pathname === '/aide')

  // `/aide` est publique et vit hors de la mise en page de l'application. Sans
  // la barre, toucher son onglet menait dans un écran sans retour.
  const barre = page.getByTestId('barre-onglets')
  await expect(barre).toBeVisible()
  await expect(page.getByTestId('onglet-aide')).toHaveAttribute('aria-current', 'page')

  // Et l'on en revient par où l'on est venu.
  await page.getByTestId('onglet-accueil').click()
  await page.waitForURL(url => url.pathname === '/app')
})

test('sans session, la page d’aide reste une page publique', async ({ page }) => {
  await page.goto('/aide')
  await waitForHydration(page)

  // Aucun onglet ne mènerait nulle part : un visiteur sans compte n'a pas de
  // tableau de bord, et la page est mise en cache telle quelle pour le
  // hors-ligne.
  await expect(page.getByTestId('barre-onglets')).toBeHidden()
  await expect(page.getByTestId('aide-retour')).toHaveAttribute('href', '/')
})

test('la page d’aide annonce la coupure réseau', async ({ page, context }) => {
  await page.goto('/aide')
  await waitForHydration(page)
  await expect(page.getByTestId('offline-banner')).toBeHidden()

  // C'est la page qu'on atteint sans réseau — elle est mise en cache pour ça.
  // Elle doit donc dire pourquoi le reste ne répond pas.
  await context.setOffline(true)
  await expect(page.getByTestId('offline-banner')).toBeVisible()

  await context.setOffline(false)
  await expect(page.getByTestId('offline-banner')).toBeHidden()
})
