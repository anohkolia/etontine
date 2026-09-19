import type { Browser, BrowserContext, Page } from '@playwright/test'
import { waitForHydration } from './hydration'
import { numeroDeTest } from './telephone'
import { remplirCode } from './otp'
import { canalVerifie, verifierIdentite } from './session'

/**
 * Briques communes aux parcours : un compte, une tontine publiée, un membre
 * qui rejoint par le lien.
 *
 * Tout ce qui n'est pas **le geste testé** passe par l'API : monter une tontine
 * à trois par l'interface prend une minute par test, et ce n'est jamais ce que
 * le test vérifie.
 */

/** Inscription par code à usage unique, sur le numéro donné. */
export async function inscriptionOtp(page: Page, numero = numeroDeTest()): Promise<string> {
  await page.goto('/login')
  await waitForHydration(page)
  await page.getByTestId('champ-telephone').fill(numero)
  await page.getByTestId('bouton-recevoir-code').click()

  const code = (await page.getByTestId('code-dev').textContent())?.match(/\d{6}/)?.[0]
  await remplirCode(page, 'champ-code', code!)
  await page.getByTestId('bouton-valider-code').click()
  await page.waitForURL(url => !url.pathname.startsWith('/login'))

  return numero
}

export interface MembreGere {
  nom: string
  numero: string
  parts?: number
}

/**
 * Une tontine **publiée** (pas encore démarrée) dont l'utilisateur courant est
 * président, avec ses membres gérés. Renvoie l'identifiant et le lien.
 */
export async function tontinePubliee(
  page: Page,
  membres: MembreGere[],
  options: { nom?: string, montant?: number, startDate?: string } = {},
): Promise<{ id: string, lien: string }> {
  await verifierIdentite(page)
  const canal = await canalVerifie(page, `+225${numeroDeTest()}`)

  const creation = await page.request.post('/api/v1/tontines', {
    data: { name: options.nom ?? 'Tontine des tantines', locality: 'Abobo', access: 'private' },
  })
  const { id } = await creation.json() as { id: string }

  const reglages = await page.request.fetch(`/api/v1/tontines/${id}`, {
    method: 'PATCH',
    data: {
      shareAmount: options.montant ?? 25_000,
      frequency: 'monthly',
      startDate: options.startDate ?? new Date().toISOString().slice(0, 10),
      collectionChannelIds: [canal],
    },
  })
  if (!reglages.ok()) throw new Error(`réglages refusés : ${await reglages.text()}`)

  for (const membre of membres) {
    const ajout = await page.request.post(`/api/v1/tontines/${id}/members`, {
      data: { name: membre.nom, phone: `+225${membre.numero}`, shares: membre.parts ?? 1 },
    })
    if (!ajout.ok()) throw new Error(`membre refusé : ${await ajout.text()}`)
  }

  const publication = await page.request.post(`/api/v1/tontines/${id}/publish`)
  if (!publication.ok()) throw new Error(`publication refusée : ${await publication.text()}`)

  const invitation = await page.request.post(`/api/v1/tontines/${id}/invites`)
  const { url } = await invitation.json() as { url: string }

  return { id, lien: url }
}

/**
 * Un membre géré prend son compte et se rattache à son adhésion par le lien.
 * Renvoie sa page, dans un contexte à part — c'est un autre téléphone.
 */
export async function rattacherMembre(
  browser: Browser,
  lien: string,
  numero: string,
  prenom: string,
  nom: string,
): Promise<{ page: Page, contexte: BrowserContext }> {
  const contexte = await browser.newContext()
  const page = await contexte.newPage()
  await inscriptionOtp(page, numero)
  await page.request.fetch('/api/v1/me', { method: 'PATCH', data: { firstName: prenom, lastName: nom } })

  const token = lien.split('/join/')[1]!
  const acceptation = await page.request.post(`/api/v1/invites/${token}/accept`)
  if (!acceptation.ok()) throw new Error(`rattachement refusé : ${await acceptation.text()}`)

  return { page, contexte }
}

/** L'identifiant d'adhésion d'un membre, par son nom. */
export async function adhesionDe(page: Page, tontineId: string, nom: string): Promise<string> {
  const reponse = await page.request.get(`/api/v1/tontines/${tontineId}/members`)
  const { members } = await reponse.json() as { members: Array<{ id: string, name: string | null }> }
  const membre = members.find(m => m.name === nom)
  if (!membre) throw new Error(`membre introuvable : ${nom}`)
  return membre.id
}

/**
 * Une tontine lancée par un président, vue par Koffi qui y cotise.
 *
 * Le président — qui ne cotise pas — monte et lance la tontine dans un
 * contexte à part, puis Koffi, premier membre inscrit et bénéficiaire du
 * tour 1, ouvre sa session sur `page` et rejoint son siège par le lien. C'est
 * **sa** page qu'un test de cotisation pilote : c'est lui qui déclare, qu'on
 * coupe du réseau, qui lit ce qu'il doit.
 */
export async function tontineLanceeAvecCotisant(browser: Browser, page: Page): Promise<{ id: string }> {
  const contextePresident = await browser.newContext()
  const president = await contextePresident.newPage()
  await inscriptionOtp(president)

  const numeroKoffi = numeroDeTest()
  // Trois cotisants à une part : trois tours, un pot de 75 000 FCFA.
  const { id, lien } = await tontinePubliee(president, [
    { nom: 'Koffi N’Guessan', numero: numeroKoffi },
    { nom: 'Fatou Diarra', numero: numeroDeTest() },
    { nom: 'Yao Brou', numero: numeroDeTest() },
  ])
  const demarrage = await president.request.post(`/api/v1/tontines/${id}/start`)
  if (!demarrage.ok()) throw new Error(`démarrage refusé : ${await demarrage.text()}`)
  await contextePresident.close()

  await inscriptionOtp(page, numeroKoffi)
  await page.request.fetch('/api/v1/me', { method: 'PATCH', data: { firstName: 'Koffi', lastName: 'N’Guessan' } })
  const acceptation = await page.request.post(`/api/v1/invites/${lien.split('/join/')[1]}/accept`)
  if (!acceptation.ok()) throw new Error(`rattachement refusé : ${await acceptation.text()}`)

  return { id }
}
