import { expect, test } from '@playwright/test'
import { waitForHydration } from './helpers/hydration'
import { numeroDeTest } from './helpers/telephone'
import { adhesionDe, inscriptionOtp, rattacherMembre, tontinePubliee } from './helpers/tontine'

/**
 * Le bureau se nomme depuis l'écran des membres.
 *
 * Jusqu'ici, aucun écran n'envoyait `role` : chaque tontine gardait un bureau
 * d'une seule personne, et la matrice de permissions restait théorique. Ce
 * parcours vérifie le geste du président **et** ce que voit la personne nommée.
 */

test('nommer un trésorier lui ouvre la file de confirmation', async ({ page, browser }) => {
  await inscriptionOtp(page)
  const numeroKoffi = numeroDeTest()
  const { id, lien } = await tontinePubliee(page, [
    { nom: 'Koffi N’Guessan', numero: numeroKoffi },
    { nom: 'Fatou Diarra', numero: numeroDeTest() },
  ])
  const koffi = await rattacherMembre(browser, lien, numeroKoffi, 'Koffi', 'N’Guessan')

  // Avant : Koffi est simple membre, sans onglet « Confirmer ».
  await koffi.page.goto(`/app/tontine/${id}`)
  await waitForHydration(koffi.page)
  await expect(koffi.page.getByTestId('onglets-tontine')).not.toContainText('Confirmer')

  const membreId = await adhesionDe(page, id, 'Koffi N’Guessan')
  await page.goto(`/app/tontine/${id}/membres`)
  await waitForHydration(page)

  // Fatou, gérée, peut recevoir un rôle — il s'exercera quand elle aura
  // rejoint — mais pas la présidence : présider demande un compte.
  const fatouId = await adhesionDe(page, id, 'Fatou Diarra')
  await expect(page.getByTestId(`bureau-${fatouId}`)).toContainText('Sans compte')
  await expect(page.getByTestId(`champ-role-${fatouId}`)).toHaveCount(1)
  await expect(page.getByTestId(`bouton-presidence-${fatouId}`)).toHaveCount(0)

  await page.getByTestId(`champ-role-${membreId}`).selectOption('treasurer')
  await expect(page.getByTestId(`bureau-${membreId}`)).toContainText('Confirme les cotisations')
  await page.getByTestId(`bouton-nommer-${membreId}`).click()

  // Le rôle est écrit sur la carte, en toutes lettres.
  await expect(page.getByTestId(`role-${membreId}`)).toHaveText('Trésorier')

  // Après : Koffi voit les onglets du bureau sans recharger sa session à la main.
  await koffi.page.goto(`/app/tontine/${id}`)
  await waitForHydration(koffi.page)
  await expect(koffi.page.getByTestId('onglets-tontine')).toContainText('Confirmer')

  await koffi.contexte.close()
})

test('nommer un censeur lui ouvre les impayés, sans la file de confirmation', async ({ page, browser }) => {
  await inscriptionOtp(page)
  const numeroFatou = numeroDeTest()
  const { id, lien } = await tontinePubliee(page, [
    { nom: 'Koffi N’Guessan', numero: numeroDeTest() },
    { nom: 'Fatou Diarra', numero: numeroFatou },
  ])
  const fatou = await rattacherMembre(browser, lien, numeroFatou, 'Fatou', 'Diarra')

  const membreId = await adhesionDe(page, id, 'Fatou Diarra')
  await page.goto(`/app/tontine/${id}/membres`)
  await waitForHydration(page)
  await page.getByTestId(`champ-role-${membreId}`).selectOption('auditor')
  await page.getByTestId(`bouton-nommer-${membreId}`).click()
  await expect(page.getByTestId(`role-${membreId}`)).toHaveText('Censeur')

  await fatou.page.goto(`/app/tontine/${id}`)
  await waitForHydration(fatou.page)
  const onglets = fatou.page.getByTestId('onglets-tontine')
  await expect(onglets).toContainText('Impayés')
  await expect(onglets).not.toContainText('Confirmer')
  await expect(onglets).not.toContainText('Verser')

  await fatou.contexte.close()
})

test('passer la présidence : l’ancien président devient membre', async ({ page, browser }) => {
  await inscriptionOtp(page)
  const numeroKoffi = numeroDeTest()
  const { id, lien } = await tontinePubliee(page, [
    { nom: 'Koffi N’Guessan', numero: numeroKoffi },
    { nom: 'Fatou Diarra', numero: numeroDeTest() },
  ])
  const koffi = await rattacherMembre(browser, lien, numeroKoffi, 'Koffi', 'N’Guessan')

  const membreId = await adhesionDe(page, id, 'Koffi N’Guessan')
  await page.goto(`/app/tontine/${id}/membres`)
  await waitForHydration(page)
  await expect(page.getByTestId('onglets-tontine')).toContainText('Réglages')

  await page.getByTestId(`bouton-presidence-${membreId}`).click()
  await expect(page.getByTestId(`confirmation-presidence-${membreId}`)).toContainText('deviendra président')
  await page.getByTestId(`bouton-confirmer-presidence-${membreId}`).click()

  await expect(page.getByTestId(`role-${membreId}`)).toHaveText('Président')
  // Mes propres onglets suivent : je ne suis plus président.
  await expect(page.getByTestId('onglets-tontine')).not.toContainText('Réglages')
  await expect(page.getByTestId(`bureau-${membreId}`)).toHaveCount(0)

  // Le nouveau président a les réglages, et le groupe a été prévenu.
  await koffi.page.goto(`/app/tontine/${id}`)
  await waitForHydration(koffi.page)
  await expect(koffi.page.getByTestId('onglets-tontine')).toContainText('Réglages')

  await koffi.page.goto('/app/notifications')
  await waitForHydration(koffi.page)
  await expect(koffi.page.locator('body')).toContainText('présidence')

  await koffi.contexte.close()
})

test('déclarer défaillant : refusé tant que le membre n’a pas pris la main', async ({ page }) => {
  await inscriptionOtp(page)
  const { id } = await tontinePubliee(page, [
    { nom: 'Koffi N’Guessan', numero: numeroDeTest() },
    { nom: 'Fatou Diarra', numero: numeroDeTest() },
  ])
  await page.request.post(`/api/v1/tontines/${id}/start`)

  const membreId = await adhesionDe(page, id, 'Koffi N’Guessan')
  await page.goto(`/app/tontine/${id}/membres`)
  await waitForHydration(page)

  await page.getByTestId(`bouton-defaillance-${membreId}`).click()
  await expect(page.getByTestId(`confirmation-defaillance-${membreId}`)).toContainText('définitif')
  await page.getByTestId(`bouton-confirmer-defaillance-${membreId}`).click()

  // Le serveur tranche, et l'écran répète sa raison : un retard n'est pas une défaillance.
  await expect(page.getByTestId('erreur-membres')).toContainText('pris la main')
})
