import { expect, test } from '@playwright/test'
import { waitForHydration } from './helpers/hydration'
import { canalVerifie, renseignerNom, seConnecter, verifierIdentite } from './helpers/session'
import { numeroDeTest } from './helpers/telephone'

/**
 * Détail et réglages d'une tontine.
 *
 * Ces deux écrans figurent au §8 du cahier depuis le début et n'existaient
 * pas. Le second manquait de la façon la plus visible : à chaque changement de
 * canal, `services/canaux.ts` notifie tous les membres vers
 * `/app/tontine/:id/reglages` — un lien mort. Et la règle 22, implémentée et
 * testée côté serveur, n'avait aucune interface pour la déclencher.
 */

/**
 * Monte une tontine lancée dont l'utilisateur est président, et renvoie le
 * numéro d'un membre géré — celui-ci pourra ouvrir sa propre session et se
 * faire rattacher à une adhésion **active**.
 *
 * Rejoindre par lien une tontine déjà lancée laisse en `pending_approval`, ce
 * qui est le bon comportement : on n'entre pas dans une tontine en cours sans
 * l'accord du bureau. Le membre simple d'une tontine lancée est donc un membre
 * que le président avait ajouté avant le démarrage.
 */
async function tontineLancee(page: import('@playwright/test').Page) {
  await seConnecter(page)
  await verifierIdentite(page)
  const canal = await canalVerifie(page, `+225${numeroDeTest()}`)

  const creation = await page.request.post('/api/v1/tontines', {
    data: { name: 'Tontine des tantines', locality: 'Abobo', access: 'private', emoji: '🧺' },
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
  const telMembre = `+225${numeroDeTest()}`
  for (const [nom, tel] of [['Koffi N’Guessan', telMembre], ['Fatou Diarra', `+225${numeroDeTest()}`]]) {
    await page.request.post(`/api/v1/tontines/${id}/members`, {
      data: { name: nom, phone: tel, shares: 1 },
    })
  }
  await page.request.post(`/api/v1/tontines/${id}/publish`)
  await page.request.post(`/api/v1/tontines/${id}/start`)
  return { id, telMembre }
}

/** Ouvre une session pour un numéro **donné**, et renseigne le palier 1. */
async function sessionPour(page: import('@playwright/test').Page, telephone: string) {
  const demande = await page.request.post('/api/v1/auth/otp/request', { data: { phone: telephone } })
  const { devCode } = await demande.json() as { devCode?: string }
  const verif = await page.request.post('/api/v1/auth/otp/verify', {
    data: { phone: telephone, code: devCode },
  })
  if (!verif.ok()) throw new Error(`connexion refusée : ${await verif.text()}`)
  await renseignerNom(page, 'Koffi', 'N’Guessan')
}

test('le détail montre le tour en cours et ce que je dois', async ({ page }) => {
  const { id } = await tontineLancee(page)
  await page.goto(`/app/tontine/${id}`)
  await waitForHydration(page)

  const tour = page.getByTestId('bloc-tour')
  await expect(tour).toBeVisible()
  await expect(tour).toContainText('Tour 1')
  await expect(tour.getByTestId('pot-gauge')).toBeVisible()

  // Le président a une part : il doit 25 000 FCFA comme les autres.
  await expect(page.getByTestId('mon-du')).toContainText('25 000 FCFA')
  await expect(page.getByTestId('lien-cotiser')).toBeVisible()

  // Trois membres à une part : le pot d'un tour vaut 75 000 FCFA.
  await expect(page.getByTestId('bloc-reglages')).toContainText('75 000 FCFA')
})

test('le calendrier de passage dit quand chacun prend la main', async ({ page }) => {
  const { id } = await tontineLancee(page)

  await page.goto(`/app/tontine/${id}`)
  await waitForHydration(page)

  // « Je passe quand ? » est la première question qu'on se pose, et l'écran n'y
  // répondait pas : il ne montrait que le tour courant, et la liste des membres
  // donnait une position sans jamais une date.
  const calendrier = page.getByTestId('calendrier-tours')
  await expect(calendrier).toBeVisible()
  await expect(calendrier.locator('li')).toHaveCount(3)

  // Le tour du président est le premier, et il est signalé par le **mot**,
  // jamais par la seule teinte de la carte.
  await expect(page.getByTestId('tour-1')).toContainText('c’est toi')
})

test('un seul appel de données peint le détail', async ({ page }) => {
  const { id } = await tontineLancee(page)

  const appels: string[] = []
  page.on('request', (requete) => {
    const chemin = new URL(requete.url()).pathname
    // `/auth/me` et le compteur de notifications appartiennent à la coquille
    // authentifiée, pas à cet écran : la cloche de l'en-tête s'affiche sur
    // toutes les pages. Ce que l'acceptation interdit, c'est un appel par
    // bloc de contenu — tour courant, membres, calendrier.
    const coquille = ['/api/v1/auth/me', '/api/v1/me/notifications']
    if (chemin.startsWith('/api/v1/') && !coquille.includes(chemin)) appels.push(chemin)
  })

  await page.goto(`/app/tontine/${id}`)
  await waitForHydration(page)
  await expect(page.getByTestId('bloc-tour')).toBeVisible()

  expect(appels).toEqual([`/api/v1/tontines/${id}`])
})

test('la carte du tableau de bord mène au détail, pas au registre', async ({ page }) => {
  const { id } = await tontineLancee(page)
  await page.goto('/app')
  await waitForHydration(page)

  await page.getByTestId(`lien-tontine-${id}`).click()
  await page.waitForURL(new RegExp(`/app/tontine/${id}$`))
  await expect(page.getByTestId('bloc-tour')).toBeVisible()
})

test('le président change de numéro de collecte, prévenu du gel de 48 h', async ({ page }) => {
  const { id } = await tontineLancee(page)
  const second = await canalVerifie(page, `+225${numeroDeTest()}`)

  await page.goto(`/app/tontine/${id}/reglages`)
  await waitForHydration(page)

  // Tant que rien ne change, aucun avertissement : on n'effraie pas pour rien.
  await expect(page.getByTestId('avertissement-changement-canal')).toBeHidden()

  await page.getByTestId(`canal-${second}`).check()

  // Règle 22 : l'avertissement se lit **avant** de valider.
  const avertissement = page.getByTestId('avertissement-changement-canal')
  await expect(avertissement).toBeVisible()
  await expect(avertissement).toContainText('48 heures')
  await expect(avertissement).toContainText('Tous les membres seront prévenus')

  await page.getByTestId('bouton-enregistrer-reglages').click()
  await expect(page.getByTestId('reglages-enregistres')).toBeVisible()

  // Le gel court, et l'écran le dit avec sa date de fin.
  await expect(page.getByTestId('gel-en-cours')).toBeVisible()

  // Le changement est inscrit au registre, visible de tous les membres.
  const registre = await page.request.get(`/api/v1/tontines/${id}/ledger?limit=100`)
  const { items } = await registre.json() as { items: Array<{ type: string }> }
  expect(items.some(e => e.type === 'settings_changed')).toBe(true)
})

test('les réglages d’argent sont figés une fois la tontine lancée', async ({ page }) => {
  const { id } = await tontineLancee(page)
  await page.goto(`/app/tontine/${id}/reglages`)
  await waitForHydration(page)

  await expect(page.getByTestId('reglages-figes')).toBeVisible()
  // Le nom aussi : il figure dans les invitations déjà envoyées.
  await expect(page.getByTestId('champ-nom')).toBeDisabled()
  // La présentation, elle, reste modifiable.
  await expect(page.getByTestId('champ-lieu')).toBeEnabled()
})

test('un membre simple ne voit ni le lien ni le formulaire de réglages', async ({ page, browser }) => {
  const { id, telMembre } = await tontineLancee(page)
  const invitation = await page.request.post(`/api/v1/tontines/${id}/invites`)
  const { token } = await invitation.json() as { token: string }

  // Le président, lui, y a droit.
  await page.goto(`/app/tontine/${id}`)
  await waitForHydration(page)
  await expect(page.getByTestId('lien-reglages')).toBeVisible()

  // Seconde session, vraiment séparée. Le membre ouvre son compte avec le
  // numéro que le président avait enregistré : son adhésion gérée est
  // rattachée, sans duplication d'historique (T12).
  const contexte = await browser.newContext()
  const membre = await contexte.newPage()
  await membre.goto('/')
  await sessionPour(membre, telMembre)
  const adhesion = await membre.request.post(`/api/v1/invites/${token}/accept`)
  expect(adhesion.ok()).toBe(true)

  await membre.goto(`/app/tontine/${id}`)
  await waitForHydration(membre)
  await expect(membre.getByTestId('bloc-tour')).toBeVisible()
  await expect(membre.getByTestId('lien-reglages')).toHaveCount(0)

  // Et s'il force l'adresse, l'écran le dit au lieu de montrer un formulaire
  // que le serveur refuserait de toute façon.
  await membre.goto(`/app/tontine/${id}/reglages`)
  await waitForHydration(membre)
  await expect(membre.getByTestId('refus-reglages')).toBeVisible()
  await expect(membre.getByTestId('bouton-enregistrer-reglages')).toHaveCount(0)

  // Le serveur reste l'autorité : il refuse, écran ou pas.
  const refus = await membre.request.fetch(`/api/v1/tontines/${id}`, {
    method: 'PATCH',
    data: { locality: 'Yopougon' },
  })
  expect(refus.status()).toBe(403)

  await contexte.close()
})
