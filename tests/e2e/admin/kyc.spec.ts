import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { eq } from 'drizzle-orm'
import { useDb } from '../../../server/db/index.ts'
import { users } from '../../../server/db/schema.ts'
import { waitForHydration } from '../helpers/hydration'
import { numeroDeTest } from '../helpers/telephone'
import { remplirCode } from '../helpers/otp'

/**
 * Back-office — vérification d'identité.
 *
 * Ces tests visent le **second serveur** (port 3001). L'application des membres
 * n'expose aucune route d'administration ; c'est précisément ce qu'on vérifie
 * au passage.
 *
 * La session d'administration est ouverte une fois par le projet
 * `admin-setup` : les demandes de code sont plafonnées par numéro, et cette
 * garde ne doit pas être désactivée pour la commodité des tests.
 */

const APP_MEMBRE = 'http://localhost:3000'

/** Un contexte vierge, pour les tests qui vérifient l'écran de connexion. */
const SANS_SESSION = { storageState: { cookies: [], origins: [] } }

/** Inscrit un compte sur l'application des membres. */
async function inscrireSurAppMembre(page: Page, numero: string) {
  await page.goto(`${APP_MEMBRE}/login`)
  await waitForHydration(page)
  await page.getByTestId('champ-telephone').fill(numero)
  await page.getByTestId('bouton-recevoir-code').click()

  const code = (await page.getByTestId('code-dev').textContent())?.match(/\d{6}/)?.[0]
  await remplirCode(page, 'champ-code', code!)
  await page.getByTestId('bouton-valider-code').click()
  await page.waitForURL(url => !url.pathname.startsWith('/login'))
}

/**
 * Un membre qui a déposé ses pièces et attend un examen.
 *
 * L'état `pending_review` est posé directement en base après le dépôt : hors
 * production, `POST /me/kyc` approuve d'office, et sans ce forçage aucun
 * dossier n'atteindrait jamais la file — le parcours réel de l'administrateur
 * resterait invérifié. C'est une donnée d'amorçage, pas un contournement : le
 * comportement examiné ensuite est bien celui du back-office.
 */
async function deposerUnDossierEnAttente(page: Page, nom: { prenom: string, nom: string }) {
  const numero = numeroDeTest()
  await inscrireSurAppMembre(page, numero)

  await page.request.fetch(`${APP_MEMBRE}/api/v1/me`, {
    method: 'PATCH',
    data: { firstName: nom.prenom, lastName: nom.nom },
  })

  // Un JPEG minimal : le contenu importe peu, c'est le parcours qu'on éprouve.
  const image = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46])
  const depots: string[] = []

  for (const fichier of ['piece.jpg', 'selfie.jpg']) {
    const reponse = await page.request.post(`${APP_MEMBRE}/api/v1/uploads/proof`, {
      multipart: { file: { name: fichier, mimeType: 'image/jpeg', buffer: image } },
    })
    const { url } = await reponse.json() as { url: string }
    depots.push(url)
  }

  await page.request.post(`${APP_MEMBRE}/api/v1/me/kyc`, {
    data: { documentUrl: `${APP_MEMBRE}${depots[0]}`, selfieUrl: `${APP_MEMBRE}${depots[1]}` },
  })

  const e164 = `+225${numero}`
  useDb().update(users)
    .set({ kycStatus: 'pending_review', kycLevel: 1 })
    .where(eq(users.phone, e164))
    .run()

  return e164
}

test.describe('parcours de connexion', () => {
  test.use(SANS_SESSION)

  test('sans session, toute page du back-office ramène à la connexion', async ({ page }) => {
    await page.goto('/dossiers')
    await page.waitForURL(url => url.pathname === '/')
    await expect(page.getByTestId('champ-telephone')).toBeVisible()
  })

  test('un numéro non autorisé est refusé, même avec un code valide', async ({ page }) => {
    await page.goto('/')
    await waitForHydration(page)

    await page.getByTestId('champ-telephone').fill(numeroDeTest())
    await page.getByTestId('bouton-recevoir-code').click()

    // Le code est bien envoyé : ce point d'entrée ne révèle pas qui est
    // administrateur. C'est la vérification qui filtre.
    const code = (await page.getByTestId('code-dev').textContent())?.match(/\d{6}/)?.[0]
    expect(code).toMatch(/^\d{6}$/)

    await remplirCode(page, 'champ-code', code!)
    await page.getByTestId('bouton-valider-code').click()

    await expect(page.getByTestId('erreur-connexion')).toContainText('refusé')
    expect(page.url()).not.toContain('/dossiers')
  })
})

test('l’administrateur examine un dossier et l’approuve', async ({ page, browser }) => {
  const contexteMembre = await browser.newContext()
  const membre = await contexteMembre.newPage()
  const numero = await deposerUnDossierEnAttente(membre, { prenom: 'Aya', nom: 'Koné' })

  await page.goto('/dossiers')
  await waitForHydration(page)

  // Le dossier est dans la file, identifié par son numéro.
  const carte = page.locator('[data-testid^="dossier-"]').filter({ hasText: numero })
  await expect(carte).toHaveCount(1)
  await carte.click()

  await expect(page.getByTestId('nom-dossier')).toHaveText('Aya Koné')

  // Les deux pièces sont servies par le back-office, et jamais mises en
  // cache : une pièce d'identité ne doit pas traîner dans le cache d'un poste
  // de bureau qui se partage.
  for (const testId of ['piece-document', 'piece-selfie']) {
    const piece = page.getByTestId(testId)
    await expect(piece).toBeVisible()

    const reponse = await page.request.get((await piece.getAttribute('src'))!)
    expect(reponse.status()).toBe(200)
    expect(reponse.headers()['content-type']).toContain('image/')
    expect(reponse.headers()['cache-control']).toContain('no-store')
  }

  await page.getByTestId('bouton-approuver').click()
  await expect(page.getByTestId('message-decision')).toContainText('approuvé')
  await expect(page.getByTestId('deja-traite')).toBeVisible()

  // La décision et les consultations figurent au journal, avec leur auteur.
  await page.getByTestId('onglet-journal').click()
  await waitForHydration(page)
  await expect(page.getByTestId('journal-kyc_approuve').first()).toBeVisible()
  await expect(page.getByTestId('journal-kyc_approuve').first()).toContainText('+2250500000001')
  await expect(page.getByTestId('journal-kyc_piece_consultee').first()).toBeVisible()

  await contexteMembre.close()
})

test('un rejet exige un motif, et le motif reste visible', async ({ page, browser }) => {
  const contexteMembre = await browser.newContext()
  const membre = await contexteMembre.newPage()
  const numero = await deposerUnDossierEnAttente(membre, { prenom: 'Koffi', nom: 'N’Guessan' })

  await page.goto('/dossiers')
  await waitForHydration(page)
  await page.locator('[data-testid^="dossier-"]').filter({ hasText: numero }).click()

  await page.getByTestId('bouton-rejeter').click()

  // Trop court : un refus sans explication fait redéposer la même chose.
  await page.getByTestId('champ-motif').fill('flou')
  await expect(page.getByTestId('bouton-confirmer-rejet')).toBeDisabled()

  await page.getByTestId('champ-motif').fill('La pièce est illisible : le numéro n’apparaît pas.')
  await expect(page.getByTestId('bouton-confirmer-rejet')).toBeEnabled()
  await page.getByTestId('bouton-confirmer-rejet').click()

  await expect(page.getByTestId('message-decision')).toContainText('rejeté')
  await expect(page.getByTestId('motif-precedent')).toContainText('illisible')

  // Et le dossier a quitté la file des dossiers en attente.
  await page.getByTestId('retour-liste').click()
  await waitForHydration(page)
  await expect(page.locator('[data-testid^="dossier-"]').filter({ hasText: numero })).toHaveCount(0)

  // **Le motif arrive jusqu'à l'intéressé.** C'est la moitié qui manquait : le
  // back-office exigeait une explication, la notification renvoyait le membre
  // « voir ce qui doit être corrigé », et son écran ne montrait rien.
  await membre.goto(`${APP_MEMBRE}/app/profil/identite`)
  await waitForHydration(membre)
  await expect(membre.getByTestId('motif-refus-identite')).toContainText('illisible')

  // Et le formulaire est de nouveau là : on corrige, on redépose.
  await expect(membre.getByTestId('champ-piece')).toBeVisible()

  await contexteMembre.close()
})

test('l’application des membres n’expose aucune route d’administration', async ({ page }) => {
  // La séparation est réelle : compromettre le serveur des membres ne donne
  // aucun accès aux dossiers d'identité.
  for (const chemin of ['/api/dossiers', '/api/admin/dossiers', '/api/v1/admin/dossiers']) {
    const reponse = await page.request.get(`${APP_MEMBRE}${chemin}`)
    expect(reponse.status(), chemin).toBe(404)
  }
})
