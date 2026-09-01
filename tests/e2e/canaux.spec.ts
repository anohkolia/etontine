import { expect, test } from '@playwright/test'
import { waitForHydration } from './helpers/hydration'
import { remplirCode } from './helpers/otp'
import { seConnecter, verifierIdentite } from './helpers/session'
import { numeroDeTest } from './helpers/telephone'

/**
 * Le canal de collecte, **par l'interface**.
 *
 * Les autres tests créent leur canal en tapant l'API directement
 * (`helpers/session.ts`, `canalVerifie`) : c'est rapide, et ce n'est pas ce
 * qu'ils éprouvent. Le revers, c'est que la suite entière est restée verte
 * pendant que `POST /me/channels` n'était appelé par **aucun écran** — un
 * organisateur qui venait de s'inscrire ne pouvait pas créer de tontine, et
 * rien ne le signalait.
 *
 * Ce fichier est le garde-fou : il passe par les mêmes boutons qu'un vrai
 * organisateur. S'il redevient impossible d'ajouter un numéro depuis
 * l'application, c'est ici que ça casse.
 */

/** Ajoute un numéro de collecte depuis l'écran, sans jamais toucher à l'API. */
async function ajouterCanalParLInterface(
  page: import('@playwright/test').Page,
  holderName = 'Aya Koné',
): Promise<void> {
  await page.getByTestId('bouton-ouvrir-ajout').click()
  await page.getByTestId('champ-numero-collecte').fill(numeroDeTest())
  await page.getByTestId('champ-titulaire').fill(holderName)
  await page.getByTestId('bouton-ajouter-canal').click()
}

test('un organisateur ajoute et vérifie un numéro de collecte', async ({ page }) => {
  await seConnecter(page)
  await page.goto('/app/profil/canaux')
  await waitForHydration(page)

  // Départ : aucun canal, et l'état vide propose une action — c'est ce qui
  // manquait. Un texte impératif sans bouton n'est pas un état vide.
  await expect(page.getByTestId('empty-state')).toBeVisible()
  await expect(page.getByTestId('bouton-ouvrir-ajout')).toBeVisible()

  await ajouterCanalParLInterface(page)

  // L'ajout enchaîne sur la vérification : un canal non vérifié ne sert à rien.
  const bloc = page.getByTestId('bloc-verification')
  await expect(bloc).toBeVisible()

  const code = (await page.getByTestId('code-dev-canal').textContent())?.match(/\d{6}/)?.[0]
  await remplirCode(page, 'champ-code-canal', code!)
  await page.getByTestId('bouton-valider-canal').click()

  await expect(page.getByTestId('liste-canaux')).toBeVisible()
  await expect(page.getByTestId('liste-canaux')).toContainText('Vérifié')
  await expect(page.getByTestId('liste-canaux')).toContainText('Aya Koné')
})

test('le nom du titulaire est obligatoire', async ({ page }) => {
  await seConnecter(page)
  await page.goto('/app/profil/canaux')
  await waitForHydration(page)

  await page.getByTestId('bouton-ouvrir-ajout').click()
  await page.getByTestId('champ-numero-collecte').fill(numeroDeTest())

  // Sans titulaire, on ne peut pas valider. C'est ce nom que le membre compare
  // à ce qu'affiche son application de paiement avant d'envoyer (T14) : un
  // canal sans titulaire retirerait la protection anti-arnaque n°1.
  await expect(page.getByTestId('bouton-ajouter-canal')).toBeDisabled()

  await page.getByTestId('champ-titulaire').fill('Aya Koné')
  await expect(page.getByTestId('bouton-ajouter-canal')).toBeEnabled()
})

test('un canal non vérifié est annoncé comme inutilisable', async ({ page }) => {
  await seConnecter(page)
  await page.goto('/app/profil/canaux')
  await waitForHydration(page)

  await ajouterCanalParLInterface(page)
  await expect(page.getByTestId('bloc-verification')).toBeVisible()

  // On repousse la vérification : le canal reste dans la liste, mais l'écran
  // dit franchement qu'il ne peut pas encore recevoir de cotisation.
  await page.getByRole('button', { name: 'Plus tard' }).click()

  const liste = page.getByTestId('liste-canaux')
  await expect(liste).toContainText('À vérifier')
  await expect(liste).toContainText('ne peut pas recevoir les cotisations')
})

test('le parcours complet : du wizard sans canal jusqu’au canal choisi', async ({ page }) => {
  await seConnecter(page)
  await verifierIdentite(page)

  // Le trou d'origine, joué de bout en bout : l'organisateur ouvre le wizard,
  // n'a aucun canal, et doit pouvoir s'en sortir sans quitter l'application.
  await page.goto('/app/tontine/create')
  await waitForHydration(page)
  await page.getByTestId('bouton-continuer').click()
  await page.getByTestId('champ-nom-tontine').fill('Tontine du marché')
  await page.getByTestId('bouton-continuer').click()

  await expect(page.getByTestId('etape-argent')).toBeVisible()
  await page.getByTestId('lien-ajouter-canal').click()
  await page.waitForURL(/\/app\/profil\/canaux/)
  await waitForHydration(page)

  await ajouterCanalParLInterface(page)
  const code = (await page.getByTestId('code-dev-canal').textContent())?.match(/\d{6}/)?.[0]
  await remplirCode(page, 'champ-code-canal', code!)
  await page.getByTestId('bouton-valider-canal').click()

  // Et l'on revient là d'où l'on venait, brouillon intact.
  await page.getByTestId('lien-retour-intention').click()
  await page.waitForURL(/\/app\/tontine\/create/)
  await waitForHydration(page)

  const etape = page.getByTestId('etape-argent')
  await expect(etape).toBeVisible()
  await expect(etape.getByTestId('empty-state')).toHaveCount(0)
  await expect(etape.locator('[data-testid^="canal-"]')).toHaveCount(1)
})
