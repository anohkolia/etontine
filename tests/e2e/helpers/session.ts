import type { Page } from '@playwright/test'
import { waitForHydration } from './hydration'
import { numeroDeTest } from './telephone'
import { remplirCode } from './otp'

/** Ouvre une session neuve par OTP et attend d'être dans l'application. */
export async function seConnecter(page: Page): Promise<void> {
  await page.goto('/login')
  await waitForHydration(page)
  await page.getByTestId('champ-telephone').fill(numeroDeTest())
  await page.getByTestId('bouton-recevoir-code').click()

  // En développement, le code est affiché plutôt qu'envoyé par SMS.
  const code = (await page.getByTestId('code-dev').textContent())?.match(/\d{6}/)?.[0]
  await remplirCode(page, 'champ-code', code!)
  await page.getByTestId('bouton-valider-code').click()
  await page.waitForURL(/\/app/)
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
  const reponse = await page.request.post('/api/v1/me/kyc', {
    data: {
      documentUrl: 'https://exemple.test/piece.jpg',
      selfieUrl: 'https://exemple.test/selfie.jpg',
    },
  })
  if (!reponse.ok()) throw new Error(`KYC refusé : ${reponse.status()} ${await reponse.text()}`)
}

/** Crée un canal de collecte vérifié et renvoie son identifiant. */
export async function canalVerifie(page: Page, numero: string): Promise<string> {
  const creation = await page.request.post('/api/v1/me/channels', {
    data: { provider: 'wave', msisdn: numero, holderName: 'Aya Koné' },
  })
  const { id } = await creation.json() as { id: string }

  // La vérification passe par un OTP envoyé sur le numéro de collecte lui-même.
  const envoi = await page.request.post(`/api/v1/me/channels/${id}/verify`, { data: {} })
  const { devCode } = await envoi.json() as { devCode?: string }

  const validation = await page.request.post(`/api/v1/me/channels/${id}/verify`, {
    data: { code: devCode },
  })
  if (!validation.ok()) throw new Error(`vérification du canal refusée : ${await validation.text()}`)

  return id
}
