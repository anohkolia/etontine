import { expect, test } from '@playwright/test'
import { waitForHydration } from './helpers/hydration'
import { canalVerifie, seConnecter, verifierIdentite } from './helpers/session'
import { numeroDeTest } from './helpers/telephone'

/** Monte une tontine publiée avec des membres, et renvoie son lien d'invitation. */
async function tontineAvecLien(page: import('@playwright/test').Page) {
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
      startDate: '2027-01-15',
      collectionChannelIds: [canal],
    },
  })

  // Deux membres gérés, dont un à double part : quatre parts au total.
  await page.request.post(`/api/v1/tontines/${id}/members`, {
    data: { name: 'Yao Brou', phone: `+225${numeroDeTest()}`, shares: 2 },
  })
  await page.request.post(`/api/v1/tontines/${id}/members`, {
    data: { name: 'Mariam Touré', phone: `+225${numeroDeTest()}`, shares: 1 },
  })

  await page.request.post(`/api/v1/tontines/${id}/publish`)

  const invitation = await page.request.post(`/api/v1/tontines/${id}/invites`)
  const { url } = await invitation.json() as { url: string }
  return { id, url }
}

test('un visiteur non connecté voit l’essentiel de la tontine', async ({ page, browser }) => {
  const { url } = await tontineAvecLien(page)

  // Contexte neuf, sans cookie : c'est bien un visiteur anonyme.
  const anonyme = await browser.newContext()
  const visiteur = await anonyme.newPage()
  await visiteur.goto(url)
  await waitForHydration(visiteur)

  // Acceptation T12 : nom, président, montant, fréquence, nombre de membres.
  await expect(visiteur.getByTestId('nom-tontine')).toHaveText('Tontine des tantines')
  await expect(visiteur.getByTestId('president')).toHaveText('Aya Koné')
  await expect(visiteur.getByTestId('montant')).toContainText('25 000 FCFA')
  await expect(visiteur.getByTestId('frequence')).toHaveText('Chaque mois')
  await expect(visiteur.getByTestId('nb-membres')).toHaveText('3')

  // Et le bouton propose de se connecter, sans l'imposer pour consulter.
  await expect(visiteur.getByTestId('bouton-rejoindre')).toContainText('connecter')
  await anonyme.close()
})

test('la phrase d’engagement est générée depuis les réglages réels', async ({ page, browser }) => {
  const { url } = await tontineAvecLien(page)

  const anonyme = await browser.newContext()
  const visiteur = await anonyme.newPage()
  await visiteur.goto(url)
  await waitForHydration(visiteur)

  // Quatre parts (Yao en a deux) × 25 000 = 100 000 FCFA sur quatre mois.
  const engagement = visiteur.getByTestId('engagement')
  await expect(engagement).toContainText('Tu t’engages à verser')
  await expect(engagement).toContainText('25 000 FCFA')
  await expect(engagement).toContainText('chaque mois pendant 4 mois')
  await expect(engagement).toContainText('100 000 FCFA au total')
  await expect(engagement).toContainText('Tu recevras')

  await anonyme.close()
})

test('la page publique ne divulgue pas la liste des membres', async ({ page, browser }) => {
  const { url } = await tontineAvecLien(page)

  const anonyme = await browser.newContext()
  const visiteur = await anonyme.newPage()
  await visiteur.goto(url)
  await waitForHydration(visiteur)

  // Un lien qui fuite ne doit pas livrer le carnet d'adresses du groupe.
  const contenu = await visiteur.content()
  expect(contenu).not.toContain('Yao Brou')
  expect(contenu).not.toContain('Mariam Touré')

  await anonyme.close()
})

test('le président obtient un lien partageable, à envoi manuel', async ({ page }) => {
  const { id } = await tontineAvecLien(page)

  await page.goto(`/app/tontine/${id}/membres`)
  await waitForHydration(page)

  await page.getByTestId('bouton-creer-lien').click()

  const whatsapp = page.getByTestId('lien-whatsapp')
  await expect(whatsapp).toBeVisible()

  // Message pré-rempli, mais l'envoi reste à la main de l'organisateur.
  const href = await whatsapp.getAttribute('href')
  expect(href).toContain('wa.me/?text=')
  expect(decodeURIComponent(href!)).toContain('Tontine des tantines')
  expect(decodeURIComponent(href!)).toContain('/join/')

  await expect(page.getByTestId('bouton-copier-lien')).toBeVisible()

  // Le QR sert en présentiel : replié par défaut, il s'affiche à la demande.
  await expect(page.getByTestId('image-qr')).toBeHidden()
  await page.getByTestId('bouton-qr').click()

  const qr = page.getByTestId('image-qr')
  await expect(qr).toBeVisible()

  // Il est bien servi par le serveur, en SVG : l'encodeur ne part pas dans le
  // lot client.
  const source = await qr.getAttribute('src')
  const reponse = await page.request.get(source!)
  expect(reponse.status()).toBe(200)
  expect(reponse.headers()['content-type']).toContain('image/svg+xml')
  expect(await reponse.text()).toContain('<svg')
})

test('un membre géré qui confirme est rattaché, sans doublon', async ({ page, browser }) => {
  await seConnecter(page)
  await verifierIdentite(page)
  const canal = await canalVerifie(page, `+225${numeroDeTest()}`)

  const creation = await page.request.post('/api/v1/tontines', {
    data: { name: 'Tontine de rattachement', access: 'private' },
  })
  const { id } = await creation.json() as { id: string }
  await page.request.fetch(`/api/v1/tontines/${id}`, {
    method: 'PATCH',
    data: { shareAmount: 10_000, frequency: 'monthly', startDate: '2027-01-15', collectionChannelIds: [canal] },
  })

  // Le bureau saisit Yao à la main, avec deux parts.
  const numeroYao = numeroDeTest()
  await page.request.post(`/api/v1/tontines/${id}/members`, {
    data: { name: 'Yao Brou', phone: `+225${numeroYao}`, shares: 2 },
  })
  await page.request.post(`/api/v1/tontines/${id}/publish`)
  const invitation = await page.request.post(`/api/v1/tontines/${id}/invites`)
  const { url } = await invitation.json() as { url: string }

  const avant = await (await page.request.get(`/api/v1/tontines/${id}/members`)).json() as { members: unknown[] }

  // Yao arrive enfin avec l'application, sur son propre numéro.
  const contexteYao = await browser.newContext()
  const pageYao = await contexteYao.newPage()
  await pageYao.goto('/login')
  await waitForHydration(pageYao)
  await pageYao.getByTestId('champ-telephone').fill(numeroYao)
  await pageYao.getByTestId('bouton-recevoir-code').click()
  const code = (await pageYao.getByTestId('code-dev').textContent())?.match(/\d{6}/)?.[0]
  const cases = pageYao.locator('[data-testid="champ-code"] input')
  for (const [i, chiffre] of [...code!].entries()) await cases.nth(i).fill(chiffre)
  await pageYao.getByTestId('bouton-valider-code').click()
  await pageYao.waitForURL(/\/app/)

  await pageYao.request.fetch('/api/v1/me', {
    method: 'PATCH',
    data: { firstName: 'Yao', lastName: 'Brou' },
  })
  await pageYao.goto(url)
  await waitForHydration(pageYao)
  await pageYao.getByTestId('bouton-rejoindre').click()
  await expect(pageYao.getByTestId('message-adhesion')).toBeVisible()

  const apres = await (await page.request.get(`/api/v1/tontines/${id}/members`)).json() as {
    members: Array<{ name: string | null, userId: string | null, shares: number }>
  }

  // Acceptation T12 : rattaché, pas dupliqué. Ses deux parts sont conservées.
  expect(apres.members).toHaveLength(avant.members.length)
  const yao = apres.members.find(m => m.name === 'Yao Brou')
  expect(yao?.userId).not.toBeNull()
  expect(yao?.shares).toBe(2)

  await contexteYao.close()
})
