import { expect, test } from '@playwright/test'
import { waitForHydration } from './helpers/hydration'
import { numeroDeTest } from './helpers/telephone'
import { CODE_TEST, seConnecter } from './helpers/session'
import { adhesionDe, inscription, rattacherMembre, tontinePubliee } from './helpers/tontine'

/**
 * Ce que le membre voit de ses données : le registre en entier, le fil d'une
 * contestation, son historique, ses preuves, son numéro.
 */

/** Une image PNG minuscule mais valide. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

test('le registre se charge page par page', async ({ page, browser }) => {
  await inscription(page)
  const numeroKoffi = numeroDeTest()
  const { id, lien } = await tontinePubliee(page, [
    { nom: 'Koffi N’Guessan', numero: numeroKoffi },
    { nom: 'Fatou Diarra', numero: numeroDeTest() },
  ])
  const koffi = await rattacherMembre(browser, { president: page, id, lien }, numeroKoffi, 'Koffi', 'N’Guessan')
  await page.request.fetch(`/api/v1/tontines/${id}/members/${await adhesionDe(page, id, 'Koffi N’Guessan')}`, {
    method: 'PATCH', data: { role: 'treasurer' },
  })
  await page.request.post(`/api/v1/tontines/${id}/start`)

  // Une soixantaine d'écritures : le démarrage, puis des déclarations
  // d'espèces partielles pour Fatou — de montants tous différents, sinon la
  // garde anti-doublon les fond en une seule — que le trésorier confirme
  // une à une. Le président les enregistre, il ne les valide pas.
  const detail = await (await page.request.get(`/api/v1/tontines/${id}`)).json() as { currentRound: { id: string } }
  const { items: contributions } = await (await page.request.get(`/api/v1/rounds/${detail.currentRound.id}/contributions`)).json() as { items: Array<{ id: string, membershipId: string }> }
  const fatou = await adhesionDe(page, id, 'Fatou Diarra')
  const cible = contributions.find(c => c.membershipId === fatou)!
  for (let i = 0; i < 30; i++) {
    const declaration = await page.request.post(`/api/v1/contributions/${cible.id}/declare-cash`, {
      headers: { 'Idempotency-Key': `pagination-${i}-${Date.now()}` },
      data: { amount: 100 + i, channel: 'cash', membershipId: cible.membershipId },
    })
    if (!declaration.ok()) throw new Error(`déclaration ${i} refusée : ${await declaration.text()}`)
    const { declarationId } = await declaration.json() as { declarationId: string }
    const confirmation = await koffi.page.request.post(`/api/v1/declarations/${declarationId}/confirm`, {
      headers: { 'Idempotency-Key': `pagination-confirmation-${i}-${Date.now()}` },
    })
    if (!confirmation.ok()) throw new Error(`confirmation ${i} refusée : ${await confirmation.text()}`)
  }

  await page.goto(`/app/tontine/${id}/registre`)
  await waitForHydration(page)
  const avant = await page.getByTestId('liste-registre').locator('li').count()
  expect(avant).toBeLessThanOrEqual(50)

  await page.getByTestId('bouton-suite-registre').click()
  await expect(async () => {
    expect(await page.getByTestId('liste-registre').locator('li').count()).toBeGreaterThan(avant)
  }).toPass()
  // La toute première écriture — le démarrage — finit par être visible.
  await expect(page.getByTestId('ecriture-1')).toBeVisible()

  await koffi.contexte.close()
})

test('un membre suit sa contestation, et le censeur la tranche', async ({ page, browser }) => {
  await inscription(page)
  const numeroKoffi = numeroDeTest()
  const numeroFatou = numeroDeTest()
  const { id, lien } = await tontinePubliee(page, [
    { nom: 'Koffi N’Guessan', numero: numeroKoffi },
    { nom: 'Fatou Diarra', numero: numeroFatou },
  ])
  const koffi = await rattacherMembre(browser, { president: page, id, lien }, numeroKoffi, 'Koffi', 'N’Guessan')
  const fatou = await rattacherMembre(browser, { president: page, id, lien }, numeroFatou, 'Fatou', 'Diarra')
  await page.request.fetch(`/api/v1/tontines/${id}/members/${await adhesionDe(page, id, 'Fatou Diarra')}`, {
    method: 'PATCH', data: { role: 'auditor' },
  })
  await page.request.post(`/api/v1/tontines/${id}/start`)

  // Koffi signale une erreur sur la première écriture du registre.
  await koffi.page.goto(`/app/tontine/${id}/registre`)
  await waitForHydration(koffi.page)
  await koffi.page.locator('[data-testid^="bouton-signaler-"]').first().click()
  await koffi.page.locator('[data-testid^="champ-signalement-"]').first().fill('Ce n’est pas la bonne date de départ')
  await koffi.page.locator('[data-testid^="bouton-envoyer-signalement-"]').first().click()

  // Le fil apparaît sur son propre écran, pas seulement chez le bureau.
  await expect(koffi.page.getByTestId('section-contestations')).toContainText('bonne date')
  // Simple membre : il répond, il ne tranche pas.
  await expect(koffi.page.locator('[data-testid^="champ-reponse-"]')).toHaveCount(1)
  await expect(koffi.page.locator('[data-testid^="champ-resolution-"]')).toHaveCount(0)

  // La censeure voit le fil, répond, puis conclut.
  await fatou.page.goto(`/app/tontine/${id}/registre`)
  await waitForHydration(fatou.page)
  await fatou.page.locator('[data-testid^="champ-reponse-"]').first().fill('La date a été convenue en réunion')
  await fatou.page.locator('[data-testid^="bouton-repondre-"]').first().click()
  await expect(fatou.page.getByTestId('section-contestations')).toContainText('convenue en réunion')

  await fatou.page.locator('[data-testid^="champ-resolution-"]').first().fill('Écriture exacte, contestation close')
  await fatou.page.locator('[data-testid^="bouton-clore-"]').first().click()
  await expect(fatou.page.locator('[data-testid^="conclusion-"]').first()).toContainText('Écriture exacte')

  // Koffi est prévenu, et lit la conclusion depuis son registre.
  await koffi.page.goto('/app/notifications')
  await waitForHydration(koffi.page)
  await expect(koffi.page.locator('body')).toContainText('tranchée')
  await koffi.page.goto(`/app/tontine/${id}/registre`)
  await waitForHydration(koffi.page)
  await expect(koffi.page.locator('[data-testid^="conclusion-"]').first()).toContainText('Écriture exacte')

  await koffi.contexte.close()
  await fatou.contexte.close()
})

test('l’historique montre le tour passé et donne le reçu', async ({ page, browser }) => {
  await inscription(page)
  const numeroKoffi = numeroDeTest()
  // Trois cotisants : Koffi, premier inscrit, prend la main au tour 1, et
  // deux tours restent à venir. Le président, lui, ne cotise pas.
  const { id, lien } = await tontinePubliee(page, [
    { nom: 'Koffi N’Guessan', numero: numeroKoffi },
    { nom: 'Fatou Diarra', numero: numeroDeTest() },
    { nom: 'Yao Brou', numero: numeroDeTest() },
  ])
  const koffi = await rattacherMembre(browser, { president: page, id, lien }, numeroKoffi, 'Koffi', 'N’Guessan')
  await page.request.post(`/api/v1/tontines/${id}/start`)

  // Koffi déclare sa cotisation ; le président la confirme.
  await koffi.page.goto(`/app/tontine/${id}/cotiser`)
  await waitForHydration(koffi.page)
  await koffi.page.locator('[data-testid^="bouton-envoyer-"]').first().click()
  await koffi.page.getByTestId('bouton-jai-envoye').click()
  await koffi.page.getByTestId('bouton-declarer').click()
  await expect(koffi.page.getByTestId('message-declaration')).toContainText('trésorier')

  await page.goto(`/app/tontine/${id}/confirmations`)
  await waitForHydration(page)
  await page.locator('[data-testid^="bouton-confirmer-"]').first().click()
  await expect(page.getByTestId('file-confirmation')).toBeHidden()

  await koffi.page.getByTestId('onglets-tontine').getByText('Historique').click()
  await koffi.page.waitForURL(/\/historique/)
  await waitForHydration(koffi.page)

  await expect(koffi.page.getByTestId('total-verse')).toContainText('25 000')
  await expect(koffi.page.getByTestId('historique-tour-1')).toContainText('c’est toi')
  await koffi.page.locator('[data-testid^="bouton-recu-"]').first().click()
  await expect(koffi.page.locator('[data-testid^="lien-recu-"]').first()).toHaveAttribute('href', /\/recu\//)
  await expect(koffi.page.getByTestId('tours-a-venir')).toContainText('2 tours à venir')

  await koffi.contexte.close()
})

test('une déclaration en attente peut recevoir sa capture après coup', async ({ page, browser }) => {
  await inscription(page)
  const numeroKoffi = numeroDeTest()
  const { id, lien } = await tontinePubliee(page, [
    { nom: 'Koffi N’Guessan', numero: numeroKoffi },
    { nom: 'Fatou Diarra', numero: numeroDeTest() },
  ])
  const koffi = await rattacherMembre(browser, { president: page, id, lien }, numeroKoffi, 'Koffi', 'N’Guessan')
  await page.request.fetch(`/api/v1/tontines/${id}/members/${await adhesionDe(page, id, 'Koffi N’Guessan')}`, {
    method: 'PATCH', data: { role: 'treasurer' },
  })
  await page.request.post(`/api/v1/tontines/${id}/start`)

  // Le trésorier déclare sa propre cotisation : elle attend le président.
  await koffi.page.goto(`/app/tontine/${id}/cotiser`)
  await waitForHydration(koffi.page)
  await koffi.page.locator('[data-testid^="bouton-envoyer-"]').first().click()
  await koffi.page.getByTestId('bouton-jai-envoye').click()
  await koffi.page.getByTestId('bouton-declarer').click()
  await expect(koffi.page.getByTestId('message-declaration')).toContainText('trésorier')

  const champ = koffi.page.locator('[data-testid^="champ-preuve-tardive-"]').first()
  await expect(champ).toBeAttached()
  await champ.setInputFiles({ name: 'capture.png', mimeType: 'image/png', buffer: PNG })
  await expect(koffi.page.locator('[data-testid^="preuve-jointe-"]').first()).toBeVisible({ timeout: 20_000 })

  // Le président voit la capture dans sa file.
  await page.goto(`/app/tontine/${id}/confirmations`)
  await waitForHydration(page)
  await expect(page.getByTestId('file-confirmation').locator('img, a[href*="/uploads/proof/"]').first()).toBeAttached()

  await koffi.contexte.close()
})

test('le versement du pot accepte une capture', async ({ page, browser }) => {
  await inscription(page)
  const numeroKoffi = numeroDeTest()
  const { id, lien } = await tontinePubliee(page, [
    { nom: 'Koffi N’Guessan', numero: numeroKoffi },
    { nom: 'Fatou Diarra', numero: numeroDeTest() },
  ])
  const koffi = await rattacherMembre(browser, { president: page, id, lien }, numeroKoffi, 'Koffi', 'N’Guessan')
  await page.request.fetch(`/api/v1/tontines/${id}/members/${await adhesionDe(page, id, 'Koffi N’Guessan')}`, {
    method: 'PATCH', data: { role: 'treasurer' },
  })
  await page.request.post(`/api/v1/tontines/${id}/start`)

  // Tout le monde a cotisé en espèces : le président les enregistre, le
  // trésorier les confirme — personne ne valide ce qu'il a lui-même écrit.
  const detail = await (await page.request.get(`/api/v1/tontines/${id}`)).json() as { currentRound: { id: string } }
  const { items: contributions } = await (await page.request.get(`/api/v1/rounds/${detail.currentRound.id}/contributions`)).json() as { items: Array<{ id: string, membershipId: string }> }
  for (const c of contributions) {
    const declaration = await page.request.post(`/api/v1/contributions/${c.id}/declare-cash`, {
      headers: { 'Idempotency-Key': `${c.id}-${Date.now()}` },
      data: { amount: 25_000, channel: 'cash', membershipId: c.membershipId },
    })
    const { declarationId } = await declaration.json() as { declarationId: string }
    const confirmation = await koffi.page.request.post(`/api/v1/declarations/${declarationId}/confirm`, {
      headers: { 'Idempotency-Key': `confirmation-${c.id}-${Date.now()}` },
    })
    if (!confirmation.ok()) throw new Error(`confirmation refusée : ${await confirmation.text()}`)
  }

  await page.goto(`/app/tontine/${id}/versement`)
  await waitForHydration(page)
  const msisdn = (await page.getByTestId('nom-beneficiaire').locator('..').textContent()) ?? ''
  const quatre = msisdn.match(/(\d{4})\D*$/)?.[1] ?? '0000'
  await page.getByTestId('champ-quatre-chiffres').fill(quatre)
  await page.getByTestId('bouton-preparer').click()

  await page.getByTestId('champ-preuve-versement').setInputFiles({ name: 'envoi.png', mimeType: 'image/png', buffer: PNG })
  await expect(page.getByTestId('poids-preuve-versement')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('bouton-declarer-versement').click()
  await expect(page.getByTestId('etape-accuse')).toBeVisible()

  const versement = await (await page.request.get(`/api/v1/rounds/${detail.currentRound.id}/payout`)).json() as { payout: { proofUrl?: string | null } }
  expect(versement.payout.proofUrl ?? null).not.toBeNull()

  await koffi.contexte.close()
})

test('le lien de paiement d’un canal se saisit et se propose au membre', async ({ page }) => {
  await seConnecter(page)
  await page.goto('/app/profil/canaux')
  await waitForHydration(page)
  await page.getByTestId('bouton-ouvrir-ajout').click()
  await page.getByTestId('champ-numero-collecte').fill(numeroDeTest())
  await page.getByTestId('champ-titulaire').fill('Aya Koné')

  await page.getByTestId('champ-lien-paiement').fill('http://pas-securise.example')
  await expect(page.getByTestId('erreur-lien-paiement')).toBeVisible()
  await expect(page.getByTestId('bouton-ajouter-canal')).toBeDisabled()

  await page.getByTestId('champ-lien-paiement').fill('https://pay.wave.com/m/M_ci_test')
  await page.getByTestId('champ-code-canal').fill(CODE_TEST)
  await page.getByTestId('bouton-ajouter-canal').click()
  // Le canal créé apparaît dans la liste : c'est le signe que l'envoi est
  // passé — interroger l'API avant serait une course.
  await expect(page.getByTestId('liste-canaux')).toBeVisible()

  const canaux = await (await page.request.get('/api/v1/me/channels')).json() as Array<{ paymentLinkUrl: string | null }>
  expect(canaux.some(c => c.paymentLinkUrl === 'https://pay.wave.com/m/M_ci_test')).toBe(true)
})

test('changer de numéro exige le code d’accès', async ({ page }) => {
  await seConnecter(page)
  await page.goto('/app/profil')
  await waitForHydration(page)

  const nouveau = numeroDeTest()
  await page.getByTestId('bouton-changer-numero').click()
  await page.getByTestId('champ-nouveau-numero').fill(nouveau)

  // Le mauvais code ne change rien : le numéro est l'identifiant du compte
  // et l'adresse du pot, la session seule ne suffit pas.
  await page.getByTestId('champ-code-numero').fill('9999')
  await page.getByTestId('bouton-valider-numero').click()
  await expect(page.getByTestId('message-numero')).toContainText('incorrect')

  await page.getByTestId('champ-code-numero').fill(CODE_TEST)
  await page.getByTestId('bouton-valider-numero').click()

  await expect(page.getByTestId('profil-enregistre')).toContainText('Numéro changé')
  await expect(page.getByTestId('numero-actuel')).toContainText(nouveau.slice(-4))
})

test('un simple membre ne voit pas les numéros des autres', async ({ page, browser }) => {
  await inscription(page)
  const numeroKoffi = numeroDeTest()
  const numeroFatou = numeroDeTest()
  const { id, lien } = await tontinePubliee(page, [
    { nom: 'Koffi N’Guessan', numero: numeroKoffi },
    { nom: 'Fatou Diarra', numero: numeroFatou },
  ])
  const koffi = await rattacherMembre(browser, { president: page, id, lien }, numeroKoffi, 'Koffi', 'N’Guessan')

  // Le président voit tout.
  await page.goto(`/app/tontine/${id}/membres`)
  await waitForHydration(page)
  await expect(page.getByTestId('liste-membres')).toContainText(numeroFatou.slice(-4))

  // Koffi voit le sien, pas celui de Fatou.
  await koffi.page.goto(`/app/tontine/${id}/membres`)
  await waitForHydration(koffi.page)
  await expect(koffi.page.getByTestId('liste-membres')).toContainText(numeroKoffi.slice(-4))
  await expect(koffi.page.getByTestId('liste-membres')).not.toContainText(numeroFatou.slice(-4))

  await koffi.contexte.close()
})
