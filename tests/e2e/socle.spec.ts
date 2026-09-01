import { expect, test } from '@playwright/test'

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
