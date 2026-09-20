import type { Page } from '@playwright/test'
import { waitForHydration } from './hydration'
import { numeroDeTest } from './telephone'

/** Le code d'accès de tous les comptes de test. Hors de la liste des codes interdits. */
export const CODE_TEST = '2604'

/** L'adresse e-mail dérivée d'un numéro : unique par compte, et lisible dans les journaux. */
export function emailDeTest(numero: string): string {
  return `${numero.replace(/\D/g, '')}@test.etontine.ci`
}

/**
 * Inscrit un compte par l'API et le confirme, sans ouvrir de session.
 *
 * Le lien de confirmation est renvoyé par l'API hors production (`devToken`) :
 * c'est ce qui remplace la boîte mail. Un numéro déjà confirmé ne reçoit pas
 * de jeton — le compte existe, on ne fait rien.
 */
export async function inscrireParApi(page: Page, numero: string, code = CODE_TEST, base = ''): Promise<void> {
  const inscription = await page.request.post(`${base}/api/v1/auth/register`, {
    data: { phone: numero, email: emailDeTest(numero), code },
  })
  if (!inscription.ok()) throw new Error(`inscription refusée : ${inscription.status()} ${await inscription.text()}`)

  const { devToken } = await inscription.json() as { devToken?: string }
  if (!devToken) return

  const confirmation = await page.request.post(`${base}/api/v1/auth/confirm`, { data: { token: devToken } })
  if (!confirmation.ok()) throw new Error(`confirmation refusée : ${confirmation.status()} ${await confirmation.text()}`)

  // La confirmation ouvre une session : on la ferme, la connexion par l'écran
  // en rouvrira une — c'est elle qui déverrouille l'onglet.
  await page.request.post(`${base}/api/v1/auth/logout`)
}

/**
 * Une session sur l'application des membres, depuis un test qui vit sur une
 * autre origine — le back-office. `base` est l'adresse de l'application des
 * membres. Par l'écran, comme `seConnecter` : c'est la connexion qui
 * déverrouille l'onglet, et ces tests y naviguent ensuite.
 */
export async function sessionSurAppMembre(page: Page, numero: string, base = '', code = CODE_TEST): Promise<void> {
  await seConnecter(page, numero, code, base)
}

/**
 * Ouvre une session par l'écran de connexion et attend d'être dans l'application.
 *
 * Le compte est inscrit et confirmé au passage s'il ne l'est pas encore. Le
 * numéro se choisit quand il doit correspondre à quelqu'un — le membre géré
 * que le président a inscrit, et qui vient rejoindre avec son propre compte.
 */
export async function seConnecter(page: Page, numero = numeroDeTest(), code = CODE_TEST, base = ''): Promise<string> {
  await inscrireParApi(page, numero, code, base)

  await page.goto(`${base}/login`)
  await waitForHydration(page)
  await page.getByTestId('champ-telephone').fill(numero)
  await page.getByTestId('champ-code').fill(code)
  await page.getByTestId('bouton-connexion').click()
  await page.waitForURL(/\/app/)

  return numero
}

/** Renseigne le nom : palier KYC 1, exigé pour rejoindre une tontine. */
export async function renseignerNom(page: Page, prenom = 'Aya', nom = 'Koné'): Promise<void> {
  const reponse = await page.request.fetch('/api/v1/me', {
    method: 'PATCH',
    data: { firstName: prenom, lastName: nom },
  })
  if (!reponse.ok()) throw new Error(`profil refusé : ${reponse.status()} ${await reponse.text()}`)
}

/**
 * Atteint le palier KYC 2, exigé pour créer une tontine.
 *
 * Hors production, le dossier est approuvé immédiatement : la revue manuelle
 * relève d'un back-office hors périmètre MVP, et sans cette facilité aucun
 * parcours de création ne serait testable.
 */
export async function verifierIdentite(page: Page): Promise<void> {
  await renseignerNom(page)

  // Les pièces sont réellement déposées : `POST /me/kyc` refuse une adresse qui
  // ne désigne pas un fichier déposé par l'appelant.
  const image = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46])
  const adresses: string[] = []

  for (const nom of ['piece.jpg', 'selfie.jpg']) {
    const depot = await page.request.post('/api/v1/me/kyc/piece', {
      multipart: { file: { name: nom, mimeType: 'image/jpeg', buffer: image } },
    })
    if (!depot.ok()) throw new Error(`dépôt refusé : ${depot.status()} ${await depot.text()}`)
    adresses.push((await depot.json() as { url: string }).url)
  }

  const reponse = await page.request.post('/api/v1/me/kyc', {
    data: { documentUrl: adresses[0], selfieUrl: adresses[1] },
  })
  if (!reponse.ok()) throw new Error(`KYC refusé : ${reponse.status()} ${await reponse.text()}`)
}

/** Déclare un canal de collecte — contre le code d'accès — et renvoie son identifiant. */
export async function canalDeclare(page: Page, numero: string, code = CODE_TEST): Promise<string> {
  const creation = await page.request.post('/api/v1/me/channels', {
    data: { provider: 'wave', msisdn: numero, holderName: 'Aya Koné', code },
  })
  if (!creation.ok()) throw new Error(`canal refusé : ${creation.status()} ${await creation.text()}`)
  const { id } = await creation.json() as { id: string }
  return id
}
