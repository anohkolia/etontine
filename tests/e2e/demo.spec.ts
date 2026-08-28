import { expect, test } from '@playwright/test'
import { waitForHydration } from './helpers/hydration'
import { remplirCode } from './helpers/otp'

/**
 * Les huit composants du socle, rendus par PrimeVue en mode unstyled et
 * habillés par le seul préréglage pass-through (`app/primevue/pt.ts`).
 *
 * Le contrat vérifié ici n'est pas pixel à pixel : c'est que chaque composant
 * se rend, porte bien les classes du préréglage, respecte les cibles tactiles
 * et réagit. Les deux profils de `playwright.config.ts` rejouent tout à
 * 360 px et à 1280 px.
 */
test.beforeEach(async ({ page }) => {
  await page.goto('/demo')
  await waitForHydration(page)
})

test('l’ordre des couches CSS est bien celui déclaré', async ({ page }) => {
  // Lecture dans le CSSOM : c'est l'ordre réellement appliqué par le
  // navigateur, pas celui qu'on croit avoir écrit.
  const layers = await page.evaluate(() => {
    const statements: string[][] = []
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList
      try {
        rules = sheet.cssRules
      }
      catch {
        continue // feuille d'une autre origine
      }
      for (const rule of Array.from(rules)) {
        // CSSLayerStatementRule : la déclaration `@layer a, b, c;`
        if ('nameList' in rule) {
          statements.push(Array.from((rule as unknown as { nameList: string[] }).nameList))
        }
      }
    }
    // Tailwind émet d'abord son propre `@layer properties;` : on cherche la
    // déclaration qui porte l'ordre applicatif, pas la première venue.
    return statements.find(names => names.includes('primevue')) ?? null
  })

  expect(layers, 'aucune déclaration @layer ne mentionne primevue').not.toBeNull()

  expect(layers).toContain('primevue')
  expect(layers!.indexOf('primevue')).toBeGreaterThan(layers!.indexOf('base'))
  expect(layers!.indexOf('primevue')).toBeLessThan(layers!.indexOf('utilities'))
})

test('aucune règle !important ne vient de nos feuilles', async ({ page }) => {
  const offenders = await page.evaluate(() => {
    const found: string[] = []
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList
      try {
        rules = sheet.cssRules
      }
      catch {
        continue
      }
      const walk = (list: CSSRuleList) => {
        for (const rule of Array.from(list)) {
          if ('cssRules' in rule) walk((rule as CSSGroupingRule).cssRules)
          const text = rule.cssText
          // `[hidden]` vient du preflight de Tailwind, en amont de nous.
          if (text.includes('!important') && !text.includes('[hidden]')) found.push(text.slice(0, 120))
        }
      }
      walk(rules)
    }
    return found
  })

  expect(offenders).toEqual([])
})

test('Button : classes du préréglage, cible tactile, état désactivé', async ({ page }) => {
  const button = page.getByRole('button', { name: 'Déclarer un paiement' })

  // Le préréglage global s'applique sans qu'aucune classe soit écrite au
  // point d'appel : si `importPT` se débranchait, cette assertion tomberait.
  await expect(button).toHaveClass(/min-h-touch/)
  await expect(button).toHaveClass(/rounded-control/)

  const box = await button.boundingBox()
  expect(box?.height).toBeGreaterThanOrEqual(44)

  await button.click()
  await expect(page.getByTestId('click-count')).toHaveText('Clics enregistrés : 1')

  await expect(page.getByRole('button', { name: 'Indisponible' })).toBeDisabled()
})

test('InputText : saisie liée au modèle', async ({ page }) => {
  const input = page.getByLabel('Nom du membre')
  await expect(input).toHaveClass(/min-h-touch/)

  await input.fill('Aya Koffi')
  await expect(page.getByTestId('name-echo')).toHaveText('Saisi : Aya Koffi')
})

test('InputOtp : six cases carrées, saisie numérique', async ({ page }) => {
  const cases = page.locator('[data-testid="section-inputotp"] input')
  await expect(cases).toHaveCount(6)

  // Règle 13 : chaque case est une cible tactile à part entière.
  const box = await cases.first().boundingBox()
  expect(box?.width).toBeGreaterThanOrEqual(44)
  expect(box?.height).toBeGreaterThanOrEqual(44)

  await remplirCode(page, 'section-inputotp', '123456')
  await expect(page.getByTestId('otp-echo')).toHaveText('Code saisi : 123456')
})

test('Card : titre, sous-titre et pied de carte', async ({ page }) => {
  const card = page.locator('[data-pc-name="card"]')
  await expect(card).toHaveClass(/rounded-card/)
  await expect(card).toContainText('Tontine des tantines')
  await expect(card).toContainText('Tour 3 sur 12')
  await expect(card.getByRole('button', { name: 'Voir le registre' })).toBeVisible()
})

test('Tag : le préréglage habille le composant PrimeVue', async ({ page }) => {
  const tag = page.getByTestId('tag-primevue')
  await expect(tag).toHaveClass(/rounded-full/)
  await expect(tag).toContainText('Tag PrimeVue')
})

test('ProgressBar : la jauge ne porte pas seule l’information', async ({ page }) => {
  const bar = page.locator('[data-pc-name="progressbar"]')
  await expect(bar).toHaveClass(/rounded-full/)
  await expect(bar).toHaveAttribute('aria-label', '4 parts confirmées sur 6')

  // Le décompte est aussi écrit en toutes lettres à côté de la jauge.
  await expect(page.getByText('4 parts confirmées sur 6', { exact: true })).toBeVisible()
})

test('Stepper : changer d’étape change le panneau', async ({ page }) => {
  const section = page.locator('[data-testid="section-stepper"]')
  await expect(section).toContainText('Ce que tu dois pour ce tour.')

  // PrimeVue rend l'en-tête d'étape comme un <button role="tab"> : le rôle
  // explicite l'emporte sur le rôle implicite. Le nom accessible inclut le
  // numéro d'étape (« 2 Où envoyer »), d'où l'expression régulière.
  await section.getByRole('tab', { name: /Où envoyer/ }).click()
  await expect(section).toContainText('Le canal de collecte et le nom du titulaire.')
})

test('Dialog : ouverture, pied d’action, fermeture', async ({ page }) => {
  await page.getByRole('button', { name: 'Ouvrir la boîte de dialogue' }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('As-tu envoyé ?')

  // Vocabulaire autorisé (règle 8) : on déclare un envoi, on n'« encaisse » pas.
  await expect(dialog).toContainText('Le trésorier')

  // Le défilement de la page est bloqué derrière la modale : sur un téléphone,
  // une page qui glisse sous la boîte de dialogue fait perdre le fil.
  await expect(page.locator('body')).toHaveClass(/p-overflow-hidden/)

  await dialog.getByRole('button', { name: 'Oui, j’ai envoyé' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.locator('body')).not.toHaveClass(/p-overflow-hidden/)
})

/* ------------------------------------------------------------------ *
 * Design system de base (T03)
 * ------------------------------------------------------------------ */

test('StatusBadge : aucun badge ne se réduit à une couleur', async ({ page }) => {
  // Règle 10 de CLAUDE.md, vérifiée sur *tous* les statuts des cinq machines à
  // états, pas sur un échantillon : chacun doit porter une icône et un mot.
  const badges = page.getByTestId('status-badge')
  const total = await badges.count()
  expect(total).toBeGreaterThanOrEqual(24)

  for (let i = 0; i < total; i++) {
    const badge = badges.nth(i)
    const statut = await badge.getAttribute('data-status')

    // L'icône est réellement rendue : @nuxt/icon tourne sans réseau, une icône
    // absente du paquet client ne produirait aucun SVG. Le testid est porté par
    // le <svg> lui-même, pas par un conteneur.
    const icone = badge.getByTestId('status-badge-icon')
    await expect(icone, `icône manquante pour ${statut}`).toHaveCount(1)
    expect(
      await icone.evaluate(el => el.tagName.toLowerCase()),
      `l’icône de ${statut} n’est pas un SVG`,
    ).toBe('svg')

    // Et le mot est présent, non vide.
    const mot = (await badge.getByTestId('status-badge-label').textContent())?.trim() ?? ''
    expect(mot.length, `mot manquant pour ${statut}`).toBeGreaterThan(0)
  }
})

test('StatusBadge : « Déclaré » n’est jamais vert', async ({ page }) => {
  // T15 : un paiement déclaré attend la confirmation du trésorier. Le vert le
  // ferait passer pour acquis.
  const declare = page.getByTestId('status-badge').filter({ hasText: 'Déclaré' }).first()
  const confirme = page.getByTestId('status-badge').filter({ hasText: 'Confirmé' }).first()

  const fond = (l: typeof declare) => l.evaluate(el => getComputedStyle(el).backgroundColor)
  const fondDeclare = await fond(declare)

  // Un fond transparent signalerait que Tailwind n'a pas balayé la table des
  // statuts : les classes seraient posées, mais sans règle pour les définir.
  expect(fondDeclare, 'le badge n’a aucun fond — @source manquant ?').not.toBe('rgba(0, 0, 0, 0)')
  expect(fondDeclare).not.toBe(await fond(confirme))
})

test('AmountDisplay : format imposé, insécable, sans montant fabriqué', async ({ page }) => {
  const montants = page.locator('[data-testid="section-amount"] [data-testid="amount"]')

  await expect(montants.nth(0)).toHaveText('25\u202F000\u00A0FCFA')
  await expect(montants.nth(1)).toHaveText('120\u202F000\u00A0FCFA')
  // Zéro est une information ; l'absence de valeur en est une autre.
  await expect(montants.nth(2)).toHaveText('0\u00A0FCFA')
  await expect(montants.nth(3)).toHaveText('—')

  // Le montant ne doit jamais se couper en fin de ligne.
  await expect(montants.first()).toHaveCSS('white-space', 'nowrap')
})

test('LoadingSkeleton : annoncé aux lecteurs d’écran, pas juste des blocs gris', async ({ page }) => {
  const squelette = page.getByTestId('loading-skeleton')
  await expect(squelette).toHaveAttribute('aria-busy', 'true')
  await expect(squelette).toContainText('Chargement en cours')
})

test('EmptyState : dit ce qui manque et ce qu’on peut faire', async ({ page }) => {
  const vide = page.getByTestId('empty-state')
  await expect(vide).toContainText('Aucune tontine pour l’instant')
  // Un écran vide sans porte de sortie laisse le membre bloqué.
  await expect(vide.getByRole('button', { name: 'Créer une tontine' })).toBeVisible()
})

test('ErrorState : rôle d’alerte et bouton de reprise', async ({ page }) => {
  const erreur = page.getByTestId('error-state')
  await expect(erreur).toHaveAttribute('role', 'alert')

  const reprise = erreur.getByTestId('error-retry')
  await expect(reprise).toBeVisible()
  const box = await reprise.boundingBox()
  expect(box?.height).toBeGreaterThanOrEqual(44)
})

test('OfflineBanner : apparaît à la coupure, disparaît au retour', async ({ page, context }) => {
  await expect(page.getByTestId('offline-banner')).toBeHidden()

  await context.setOffline(true)
  const bandeau = page.getByTestId('offline-banner')
  await expect(bandeau).toBeVisible()
  // Il dit ce qui arrive à la saisie : sans cette phrase, le membre renvoie
  // son paiement une seconde fois.
  await expect(bandeau).toContainText('partira au retour du réseau')
  // Règle 21 : aucune notification, aucun bandeau ne porte de montant.
  await expect(bandeau).not.toContainText('FCFA')

  await context.setOffline(false)
  await expect(bandeau).toBeHidden()
})
