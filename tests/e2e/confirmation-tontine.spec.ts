import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { waitForHydration } from './helpers/hydration'
import { canalDeclare, renseignerNom, seConnecter, verifierIdentite } from './helpers/session'
import { numeroDeTest } from './helpers/telephone'

/**
 * « Confirmer » une tontine en brouillon.
 *
 * Le brouillon se crée sans vérification d'identité ; le valider, non. Un
 * organisateur vérifié voit sa tontine validée d'office. Les autres sont
 * envoyés vers la vérification, avec le message qui dit pourquoi — et leur
 * confirmation est retenue : la tontine se valide d'elle-même à l'approbation
 * de leur identité, sans second « Confirmer ».
 */

const MESSAGE = 'Vérifie ton identité pour pouvoir valider ta tontine.'

/**
 * Un brouillon dont l'utilisateur courant est président, réglé par l'API : ce
 * n'est pas le wizard qu'on éprouve ici. Avec un numéro de collecte par
 * défaut — sans lui, le brouillon reste incomplet.
 */
async function brouillon(page: Page, options: { canal?: boolean } = {}): Promise<string> {
  const creation = await page.request.post('/api/v1/tontines', {
    data: { name: 'Tontine des tantines', locality: 'Abobo', access: 'private' },
  })
  if (!creation.ok()) throw new Error(`création refusée : ${await creation.text()}`)
  const { id } = await creation.json() as { id: string }

  const canal = options.canal === false ? null : await canalDeclare(page, `+225${numeroDeTest()}`)
  const reglages = await page.request.fetch(`/api/v1/tontines/${id}`, {
    method: 'PATCH',
    data: {
      shareAmount: 25_000,
      frequency: 'monthly',
      startDate: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
      ...(canal ? { collectionChannelIds: [canal] } : {}),
    },
  })
  if (!reglages.ok()) throw new Error(`réglages refusés : ${await reglages.text()}`)

  return id
}

async function statut(page: Page, id: string): Promise<string> {
  const reponse = await page.request.get(`/api/v1/tontines/${id}`)
  return (await reponse.json() as { status: string }).status
}

test('identité vérifiée : « Confirmer » valide la tontine d’office', async ({ page }) => {
  await seConnecter(page)
  await verifierIdentite(page)
  const id = await brouillon(page)

  await page.goto(`/app/tontine/${id}`)
  await waitForHydration(page)
  await expect(page.getByTestId('bloc-brouillon')).toBeVisible()
  await page.getByTestId('bouton-confirmer-tontine').click()

  // Validée, et l'on file vers l'étape suivante : inviter ses membres.
  await page.waitForURL(url => url.pathname === `/app/tontine/${id}/membres`)
  expect(await statut(page, id)).toBe('open')
})

test('identité non vérifiée : la vérification, et la tontine se valide d’elle-même à l’approbation', async ({ page }) => {
  await seConnecter(page)
  await renseignerNom(page)
  const id = await brouillon(page)

  await page.goto(`/app/tontine/${id}`)
  await waitForHydration(page)
  await page.getByTestId('bouton-confirmer-tontine').click()

  await page.waitForURL(url => url.pathname === '/app/profil/identite')
  await expect(page.getByTestId('motif-message')).toHaveText(MESSAGE)
  // Et il apprend qu'il n'aura pas à revenir la confirmer.
  await expect(page.getByTestId('motif-valider-tontine')).toContainText('validée automatiquement')
  expect(new URL(page.url()).searchParams.get('redirect')).toBe(`/app/tontine/${id}`)
  // Rien n'a été validé dans le dos de l'organisateur.
  expect(await statut(page, id)).toBe('draft')

  // De retour sur sa tontine avant d'être vérifié : sa confirmation est là,
  // en attente — son geste ne s'est pas perdu.
  await page.goto(`/app/tontine/${id}`)
  await waitForHydration(page)
  await expect(page.getByTestId('validation-demandee')).toContainText('dès que ton identité sera vérifiée')

  // L'identité approuvée — hors production, d'office —, la tontine est
  // validée sans second geste.
  await verifierIdentite(page)
  expect(await statut(page, id)).toBe('open')

  await page.reload()
  await waitForHydration(page)
  await expect(page.getByTestId('bloc-brouillon')).toBeHidden()
  await expect(page.getByTestId('validation-demandee')).toBeHidden()
})

test('depuis l’accueil, la carte d’un brouillon porte « Confirmer », et non les confirmations de cotisations', async ({ page }) => {
  await seConnecter(page)
  await renseignerNom(page)
  const id = await brouillon(page)

  await page.goto('/app')
  await waitForHydration(page)

  const carte = page.getByTestId(`carte-tontine-${id}`)
  await expect(carte.locator(`a[href="/app/tontine/${id}/confirmations"]`)).toHaveCount(0)

  const confirmer = carte.getByTestId(`action-confirmer-tontine-${id}`)
  await expect(confirmer).toHaveText('Confirmer')
  await expect(carte.getByTestId(`validation-demandee-${id}`)).toHaveCount(0)
  await confirmer.click()

  await page.waitForURL(url => url.pathname === '/app/profil/identite')
  await expect(page.getByTestId('motif-message')).toHaveText(MESSAGE)

  // Revenu à l'accueil, la carte dit que la validation attend son identité.
  await page.goto('/app')
  await waitForHydration(page)
  await expect(page.getByTestId(`validation-demandee-${id}`)).toContainText('vérification de ton identité')
})

test('un réglage manquant se dit sur place, et la tontine reste un brouillon', async ({ page }) => {
  await seConnecter(page)
  await verifierIdentite(page)
  const id = await brouillon(page, { canal: false })

  await page.goto(`/app/tontine/${id}`)
  await waitForHydration(page)
  await page.getByTestId('bouton-confirmer-tontine').click()

  await expect(page.getByTestId('erreur-confirmation')).toContainText('numéro de collecte')
  expect(new URL(page.url()).pathname).toBe(`/app/tontine/${id}`)
  expect(await statut(page, id)).toBe('draft')
})
