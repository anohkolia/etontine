import type { Browser, BrowserContext, Page } from '@playwright/test'
import { numeroDeTest } from './telephone'
import { canalDeclare, seConnecter, verifierIdentite } from './session'

/**
 * Briques communes aux parcours : un compte, une tontine publiée, un membre
 * qui rejoint par le lien.
 *
 * Tout ce qui n'est pas **le geste testé** passe par l'API : monter une tontine
 * à trois par l'interface prend une minute par test, et ce n'est jamais ce que
 * le test vérifie.
 */

/** Inscription — par e-mail, confirmée — puis connexion, sur le numéro donné. */
export async function inscription(page: Page, numero = numeroDeTest()): Promise<string> {
  return await seConnecter(page, numero)
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
  const canal = await canalDeclare(page, `+225${numeroDeTest()}`)

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
 * Le président confirme la demande de rattachement d'un membre géré.
 *
 * Le numéro n'est plus prouvé par SMS : un compte qui rejoint par le lien
 * avec le numéro d'un membre géré ne fait que *demander* son siège, et c'est
 * le président qui tranche — ici, par l'API, comme le ferait l'écran des
 * membres.
 */
export async function confirmerRattachement(president: Page, tontineId: string, nom: string): Promise<void> {
  const reponse = await president.request.get(`/api/v1/tontines/${tontineId}/members`)
  if (!reponse.ok()) throw new Error(`liste des membres refusée : ${reponse.status()} ${await reponse.text()}`)
  const { members } = await reponse.json() as { members: Array<{ id: string, name: string | null, claim: unknown }> }
  const membre = members.find(m => m.name === nom && m.claim)
  if (!membre) throw new Error(`aucune demande de rattachement pour ${nom}`)

  const confirmation = await president.request.fetch(`/api/v1/tontines/${tontineId}/members/${membre.id}`, {
    method: 'PATCH',
    data: { claim: 'confirm' },
  })
  if (!confirmation.ok()) throw new Error(`confirmation du rattachement refusée : ${await confirmation.text()}`)
}

/**
 * Un membre géré prend son compte et se rattache à son adhésion par le lien,
 * et le président confirme. Renvoie sa page, dans un contexte à part — c'est
 * un autre téléphone.
 */
export async function rattacherMembre(
  browser: Browser,
  tontine: { president: Page, id: string, lien: string },
  numero: string,
  prenom: string,
  nom: string,
): Promise<{ page: Page, contexte: BrowserContext }> {
  const contexte = await browser.newContext()
  const page = await contexte.newPage()
  await inscription(page, numero)
  await page.request.fetch('/api/v1/me', { method: 'PATCH', data: { firstName: prenom, lastName: nom } })

  const token = tontine.lien.split('/join/')[1]!
  const acceptation = await page.request.post(`/api/v1/invites/${token}/accept`)
  if (!acceptation.ok()) throw new Error(`rattachement refusé : ${await acceptation.text()}`)

  await confirmerRattachement(tontine.president, tontine.id, `${prenom} ${nom}`)

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
  await inscription(president)

  const numeroKoffi = numeroDeTest()
  // Trois cotisants à une part : trois tours, un pot de 75 000 FCFA.
  const { id, lien } = await tontinePubliee(president, [
    { nom: 'Koffi N’Guessan', numero: numeroKoffi },
    { nom: 'Fatou Diarra', numero: numeroDeTest() },
    { nom: 'Yao Brou', numero: numeroDeTest() },
  ])
  const demarrage = await president.request.post(`/api/v1/tontines/${id}/start`)
  if (!demarrage.ok()) throw new Error(`démarrage refusé : ${await demarrage.text()}`)

  await inscription(page, numeroKoffi)
  await page.request.fetch('/api/v1/me', { method: 'PATCH', data: { firstName: 'Koffi', lastName: 'N’Guessan' } })
  const acceptation = await page.request.post(`/api/v1/invites/${lien.split('/join/')[1]}/accept`)
  if (!acceptation.ok()) throw new Error(`rattachement refusé : ${await acceptation.text()}`)

  // Le président confirme que c'est bien Koffi, puis raccroche.
  await confirmerRattachement(president, id, 'Koffi N’Guessan')
  await contextePresident.close()

  return { id }
}
