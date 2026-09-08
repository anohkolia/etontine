import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { waitForHydration } from './helpers/hydration'
import { numeroDeTest } from './helpers/telephone'
import { remplirCode } from './helpers/otp'
import { canalVerifie, verifierIdentite } from './helpers/session'

/**
 * Les quatre parcours critiques (T26), joués **entièrement par l'interface**
 * là où c'est le geste réel d'un membre.
 *
 * Les deux profils de `playwright.config.ts` les rejouent à 360 px et à
 * 1280 px : ce sont les deux écrans sur lesquels l'application sera vraiment
 * utilisée — le téléphone d'un membre, et l'ordinateur du bureau.
 *
 * Ces quatre-là ne doivent jamais casser. Le reste de la suite couvre les
 * détails ; celle-ci couvre ce qui fait que l'application sert à quelque chose.
 */

/** Parcours 1, réutilisé par les autres : inscription par code à usage unique. */
async function inscriptionOtp(page: Page, numero = numeroDeTest()): Promise<string> {
  await page.goto('/login')
  await waitForHydration(page)

  await page.getByTestId('champ-telephone').fill(numero)
  await expect(page.getByTestId('champ-telephone')).toHaveValue(/^\d{2} \d{2} \d{2} \d{2} \d{2}$/)
  await page.getByTestId('bouton-recevoir-code').click()

  const cases = page.locator('[data-testid="champ-code"] input')
  await expect(cases).toHaveCount(6)
  await expect(cases.first()).toHaveAttribute('autocomplete', 'one-time-code')

  const code = (await page.getByTestId('code-dev').textContent())?.match(/\d{6}/)?.[0]
  await remplirCode(page, 'champ-code', code!)
  await page.getByTestId('bouton-valider-code').click()
  // La destination dépend du `?redirect=` : l'application, le profil, ou la
  // page d'où l'on venait. On attend simplement d'avoir quitté la connexion.
  await page.waitForURL(url => !url.pathname.startsWith('/login'))

  return numero
}

/** Une tontine lancée dont l'utilisateur courant est président et bénéficiaire du tour 1. */
async function tontineLancee(page: Page, membres: Array<{ nom: string, numero: string, parts?: number }>) {
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
      startDate: new Date().toISOString().slice(0, 10),
      collectionChannelIds: [canal],
    },
  })

  for (const membre of membres) {
    await page.request.post(`/api/v1/tontines/${id}/members`, {
      data: { name: membre.nom, phone: `+225${membre.numero}`, shares: membre.parts ?? 1 },
    })
  }

  await page.request.post(`/api/v1/tontines/${id}/publish`)
  return id
}

/* ------------------------------------------------------------------ *
 * Parcours 1 — Inscription par code à usage unique
 * ------------------------------------------------------------------ */

test('parcours 1 — inscription par code à usage unique', async ({ page }) => {
  await inscriptionOtp(page)

  // La session est bien ouverte, dans un cookie httpOnly (règle 19).
  const session = (await page.context().cookies()).find(c => c.name === 'tontine_session')
  expect(session?.httpOnly).toBe(true)
  expect(session?.sameSite).toBe('Lax')

  // Un compte neuf atterrit sur le profil : renseigner son nom est le palier
  // KYC 1, exigé pour rejoindre une tontine. C'est le bon endroit où l'envoyer.
  expect(page.url()).toContain('/app/profil')
  await expect(page.getByTestId('champ-prenom')).toBeVisible()

  // Et le tableau de bord est bien accessible, vide pour l'instant.
  await page.goto('/app')
  await waitForHydration(page)
  await expect(page.getByTestId('bouton-creer-tontine')).toBeVisible()
})

/* ------------------------------------------------------------------ *
 * Parcours 2 — Rejoindre par lien
 * ------------------------------------------------------------------ */

test('parcours 2 — rejoindre une tontine par son lien', async ({ page, browser }) => {
  await inscriptionOtp(page)
  const numeroInvite = numeroDeTest()
  const id = await tontineLancee(page, [
    { nom: 'Koffi N’Guessan', numero: numeroInvite },
    { nom: 'Fatou Diarra', numero: numeroDeTest() },
  ])

  const invitation = await page.request.post(`/api/v1/tontines/${id}/invites`)
  const { url } = await invitation.json() as { url: string }

  // Le membre invité ouvre le lien sans être connecté.
  const contexte = await browser.newContext()
  const invite = await contexte.newPage()
  await invite.goto(url)
  await waitForHydration(invite)
  // Le bouton reste inactif tant que l'état de session n'est pas résolu.
  await expect(invite.getByTestId('bouton-rejoindre')).toBeEnabled()

  await expect(invite.getByTestId('nom-tontine')).toHaveText('Tontine des tantines')
  await expect(invite.getByTestId('montant')).toContainText('25 000 FCFA')
  await expect(invite.getByTestId('engagement')).toContainText('Tu t’engages à verser')

  // Le bouton l'invite à se connecter : il n'a pas encore de compte.
  await expect(invite.getByTestId('bouton-rejoindre')).toContainText('connecter')
  await invite.getByTestId('bouton-rejoindre').click()

  // L'intention est conservée : c'est bien sur l'invitation qu'on le renvoie.
  await invite.waitForURL(/\/login/)
  expect(invite.url()).toContain(`redirect=/join/`)

  await inscriptionOtp(invite, numeroInvite)
  await invite.request.fetch('/api/v1/me', {
    method: 'PATCH',
    data: { firstName: 'Koffi', lastName: 'N’Guessan' },
  })

  // Il revient sur l'invitation, connecté cette fois.
  await invite.goto(url)
  await waitForHydration(invite)
  await expect(invite.getByTestId('bouton-rejoindre')).toContainText('Rejoindre')
  await invite.getByTestId('bouton-rejoindre').click()
  await expect(invite.getByTestId('message-adhesion')).toBeVisible()

  // Rattaché à son adhésion existante, sans doublon.
  const membres = await (await page.request.get(`/api/v1/tontines/${id}/members`)).json() as {
    members: Array<{ name: string | null, userId: string | null }>
  }
  expect(membres.members).toHaveLength(3)
  expect(membres.members.find(m => m.name === 'Koffi N’Guessan')?.userId).not.toBeNull()

  // Un arrivant que le bureau n'avait pas saisi : il attend l'accord du
  // président, et son tableau de bord le lui dit. Sans cela, il lisait « ta
  // demande est envoyée » puis retrouvait un écran vide, sans trace d'elle.
  const contexteArrivant = await browser.newContext()
  const arrivant = await contexteArrivant.newPage()
  await inscriptionOtp(arrivant, numeroDeTest())
  await arrivant.request.fetch('/api/v1/me', {
    method: 'PATCH',
    data: { firstName: 'Mariam', lastName: 'Touré' },
  })
  await arrivant.goto(url)
  await waitForHydration(arrivant)
  await arrivant.getByTestId('bouton-rejoindre').click()
  await expect(arrivant.getByTestId('message-adhesion')).toContainText('président')

  await arrivant.goto('/app')
  await waitForHydration(arrivant)
  await expect(arrivant.getByTestId('demandes-en-attente')).toBeVisible()
  await expect(arrivant.getByTestId('demandes-en-attente')).toContainText('accepter')

  await contexteArrivant.close()

  await contexte.close()
})

/* ------------------------------------------------------------------ *
 * Parcours 3 — Cotiser : déclarer puis confirmer
 * ------------------------------------------------------------------ */

test('parcours 3 — cotiser : déclarer puis confirmer', async ({ page, browser }) => {
  // Le président monte la tontine et en rattache le trésorier.
  await inscriptionOtp(page)
  const numeroTresorier = numeroDeTest()
  const id = await tontineLancee(page, [
    { nom: 'Koffi N’Guessan', numero: numeroTresorier },
    { nom: 'Fatou Diarra', numero: numeroDeTest() },
  ])
  await page.request.post(`/api/v1/tontines/${id}/start`)

  // Le trésorier prend son poste **avant** que le président déclare, et l'ordre
  // compte : tant qu'aucun autre membre du bureau n'a de compte, le serveur
  // confirme d'office la déclaration du président faute de valideur possible
  // (data-model §2.4). Ce parcours-ci teste le cas à deux, celui où la
  // séparation joue vraiment.
  const membres = await (await page.request.get(`/api/v1/tontines/${id}/members`)).json() as {
    members: Array<{ id: string, name: string | null }>
  }
  const koffi = membres.members.find(m => m.name === 'Koffi N’Guessan')!
  await page.request.fetch(`/api/v1/tontines/${id}/members/${koffi.id}`, {
    method: 'PATCH',
    data: { role: 'treasurer' },
  })

  const contexte = await browser.newContext()
  const tresorier = await contexte.newPage()
  await inscriptionOtp(tresorier, numeroTresorier)
  await tresorier.request.fetch('/api/v1/me', {
    method: 'PATCH',
    data: { firstName: 'Koffi', lastName: 'N’Guessan' },
  })

  const lien = await page.request.post(`/api/v1/tontines/${id}/invites`)
  const { url } = await lien.json() as { url: string }
  await tresorier.request.post(`/api/v1/invites/${url.split('/join/')[1]}/accept`)

  // Le président déclare sa propre cotisation, par l'interface.
  await page.goto(`/app/tontine/${id}/cotiser`)
  await waitForHydration(page)
  await page.locator('[data-testid^="bouton-envoyer-"]').first().click()

  // L'écran « où envoyer » montre toujours le nom du titulaire.
  await expect(page.getByTestId('nom-titulaire')).toHaveText('Aya Koné')
  await expect(page.getByTestId('reference-courte')).toContainText(/^TON-[A-Z0-9]{4}$/)

  await page.getByTestId('bouton-jai-envoye').click()
  await page.getByTestId('bouton-declarer').click()
  await expect(page.getByTestId('message-declaration')).toContainText('trésorier')

  // Bleu « Déclaré », jamais vert : ce n'est pas encore confirmé. La couleur
  // se vérifie ici et pas ailleurs — c'est le seul parcours où une déclaration
  // reste réellement en attente, puisque le bureau y compte deux personnes.
  await expect(page.getByTestId('liste-cotisations')).toContainText('Déclaré')

  const badge = page.getByTestId('status-badge').filter({ hasText: 'Déclaré' }).first()
  const fond = await badge.evaluate(el => getComputedStyle(el).backgroundColor)
  const confirme = await page.evaluate(() => {
    const sonde = document.createElement('span')
    sonde.className = 'bg-confirmed-surface'
    document.body.appendChild(sonde)
    const couleur = getComputedStyle(sonde).backgroundColor
    sonde.remove()
    return couleur
  })
  expect(fond).not.toBe(confirme)

  await tresorier.goto(`/app/tontine/${id}/confirmations`)
  await waitForHydration(tresorier)

  const carte = tresorier.getByTestId('file-confirmation').locator('li').first()
  await expect(carte).toContainText('25 000 FCFA')
  await carte.locator('[data-testid^="bouton-confirmer-"]').click()

  // Confirmée : le pot avance, et l'écriture est au registre.
  await expect(tresorier.getByTestId('file-confirmation')).toBeHidden()

  await page.goto(`/app/tontine/${id}/registre`)
  await waitForHydration(page)
  await expect(page.getByTestId('liste-registre')).toContainText('Cotisation confirmée')

  await page.getByTestId('bouton-verifier-registre').click()
  await expect(page.getByTestId('registre-intact')).toBeVisible()

  await contexte.close()
})

/* ------------------------------------------------------------------ *
 * Parcours 4 — Verser le pot : déclarer puis accuser réception
 * ------------------------------------------------------------------ */

test('parcours 4 — verser le pot : déclarer puis accuser réception', async ({ page, browser }) => {
  const numeroPresident = numeroDeTest()
  const numeroTresorier = numeroDeTest()

  await inscriptionOtp(page, numeroPresident)
  const id = await tontineLancee(page, [
    { nom: 'Koffi N’Guessan', numero: numeroTresorier },
    { nom: 'Fatou Diarra', numero: numeroDeTest() },
  ])
  await page.request.post(`/api/v1/tontines/${id}/start`)

  // Le trésorier prend son poste d'abord : personne ne confirme sa propre
  // déclaration, et le pot ne peut donc pas se remplir tout seul. Tant qu'il
  // n'a pas de compte, le président serait au contraire son propre valideur —
  // le repli du bureau à une personne (data-model §2.4), qui n'est pas ce que
  // ce parcours vérifie.
  const membres = await (await page.request.get(`/api/v1/tontines/${id}/members`)).json() as {
    members: Array<{ id: string, name: string | null }>
  }
  const koffi = membres.members.find(m => m.name === 'Koffi N’Guessan')!
  await page.request.fetch(`/api/v1/tontines/${id}/members/${koffi.id}`, {
    method: 'PATCH',
    data: { role: 'treasurer' },
  })

  const lien = await page.request.post(`/api/v1/tontines/${id}/invites`)
  const { url } = await lien.json() as { url: string }

  const contexte = await browser.newContext()
  const tresorier = await contexte.newPage()
  await inscriptionOtp(tresorier, numeroTresorier)
  await tresorier.request.fetch('/api/v1/me', {
    method: 'PATCH',
    data: { firstName: 'Koffi', lastName: 'N’Guessan' },
  })
  await tresorier.request.post(`/api/v1/invites/${url.split('/join/')[1]}/accept`)

  // Le président déclare sa cotisation par l'interface.
  await page.goto(`/app/tontine/${id}/cotiser`)
  await waitForHydration(page)
  await page.locator('[data-testid^="bouton-envoyer-"]').first().click()
  await page.getByTestId('bouton-jai-envoye').click()
  await page.getByTestId('bouton-declarer').click()
  await expect(page.getByTestId('message-declaration')).toBeVisible()

  await tresorier.goto(`/app/tontine/${id}/confirmations`)
  await waitForHydration(tresorier)
  await tresorier.locator('[data-testid^="bouton-confirmer-"]').first().click()
  await expect(tresorier.getByTestId('file-confirmation')).toBeHidden()

  // Le pot contient une cotisation sur trois : incomplet, mais pas vide.
  const tours = await (await page.request.get(`/api/v1/tontines/${id}/rounds`)).json() as {
    items: Array<{ id: string, index: number }>
    currentIndex: number | null
  }
  expect(tours.currentIndex).toBe(1)

  const cotisations = await (await page.request.get(
    `/api/v1/rounds/${tours.items.find(t => t.index === 1)!.id}/contributions`,
  )).json() as { items: Array<{ status: string }> }
  expect(cotisations.items).toHaveLength(3)
  expect(cotisations.items.filter(c => c.status === 'confirmed')).toHaveLength(1)

  // Le versement se prépare depuis l'interface.
  await page.goto(`/app/tontine/${id}/versement`)
  await waitForHydration(page)
  await expect(page.getByTestId('nom-beneficiaire')).toHaveText('Aya Koné')

  // Un mauvais code est refusé : c'est le garde-fou contre l'envoi au mauvais numéro.
  await page.getByTestId('champ-quatre-chiffres').fill('0000')
  await page.getByTestId('case-pot-incomplet').check()
  await page.getByTestId('bouton-preparer').click()
  await expect(page.getByTestId('erreur-versement')).toContainText('ne correspondent pas')

  // Les bons chiffres, et le président assume le manquant.
  await page.getByTestId('champ-quatre-chiffres').fill(numeroPresident.slice(-4))
  await page.getByTestId('bouton-preparer').click()

  await expect(page.getByTestId('etape-declaration-versement')).toBeVisible()
  await page.getByTestId('bouton-declarer-versement').click()

  // Seul le bénéficiaire peut accuser réception — ici, c'est bien lui.
  await expect(page.getByTestId('etape-accuse')).toBeVisible()
  await page.getByTestId('bouton-accuser-reception').click()
  await expect(page.getByTestId('versement-termine')).toBeVisible()

  // Le tour est clos, et le registre porte tout : le versement, la réception,
  // et le manquant assumé, qui n'est pas masqué.
  await page.goto(`/app/tontine/${id}/registre`)
  await waitForHydration(page)
  await expect(page.getByTestId('liste-registre')).toContainText('Pot versé')
  await expect(page.getByTestId('liste-registre')).toContainText('Pot reçu')
  await expect(page.getByTestId('liste-registre')).toContainText('Réglage modifié')

  await page.getByTestId('bouton-verifier-registre').click()
  await expect(page.getByTestId('registre-intact')).toBeVisible()

  await contexte.close()
})
