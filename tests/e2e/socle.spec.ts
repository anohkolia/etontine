import { expect, test } from '@playwright/test'

/**
 * Fumigation du socle : la landing publique, pré-rendue. Les huit composants
 * du socle sont couverts par `demo.spec.ts` ; les quatre parcours critiques
 * (inscription OTP, rejoindre par lien, cotiser, verser) sont le ticket T26.
 */
test('la landing publique se charge', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tontine CI')
})
