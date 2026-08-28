import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8')

/**
 * Les commentaires de `main.css` parlent d'`@import` et de `!important` pour
 * expliquer les règles. On les retire avant d'analyser, sinon le fichier se
 * dénonce lui-même sur sa propre documentation.
 */
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

const mainCss = stripComments(read('app/assets/css/main.css'))
const ptPreset = read('app/primevue/pt.ts')

/**
 * Garde-fous de l'intégration PrimeVue / Tailwind (T02). Ils portent sur les
 * sources : une régression y est visible en revue, sans avoir à reconstruire.
 * Le rendu réel est vérifié par `tests/e2e/demo.spec.ts`, qui lit l'ordre des
 * couches directement dans le CSSOM du navigateur.
 */
describe('ordre des couches CSS', () => {
  const layerStatement = /^@layer\s+([^;{]+);/m.exec(mainCss)

  it('déclare les couches avant tout @import', () => {
    expect(layerStatement).not.toBeNull()
    // La première déclaration `@layer` d'une feuille fixe la priorité. Placée
    // après un `@import`, elle serait ignorée au profit de celle de Tailwind.
    expect(layerStatement!.index).toBeLessThan(mainCss.indexOf('@import'))
  })

  it('intercale `primevue` entre `base` et `components`', () => {
    const layers = layerStatement![1]!.split(',').map(l => l.trim())
    expect(layers).toEqual(['theme', 'base', 'primevue', 'components', 'utilities'])
    // Les utilitaires Tailwind passent donc après PrimeVue : c'est ce qui rend
    // tout `!important` inutile, et c'est ce que vérifie le test suivant.
    expect(layers.indexOf('primevue')).toBeGreaterThan(layers.indexOf('base'))
    expect(layers.indexOf('primevue')).toBeLessThan(layers.indexOf('utilities'))
  })
})

describe('discipline de style', () => {
  it('n’utilise aucun !important dans nos sources CSS', () => {
    expect(mainCss).not.toContain('!important')
  })

  it('ne code aucune couleur en dur dans le préréglage pass-through', () => {
    // Les couleurs passent par les tokens `@theme` ou par la palette Tailwind,
    // jamais par une valeur littérale : sinon T03 devra repasser sur chaque
    // composant pour le contrôle de contraste AA.
    expect(ptPreset).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    expect(ptPreset).not.toMatch(/\b(?:oklch|rgba?|hsla?)\(/i)
  })

  it('impose la cible tactile de 44 px aux contrôles interactifs', () => {
    // Règle 13 : Button et les cases d'OTP sont les deux surfaces qu'un membre
    // touche le plus souvent.
    expect(ptPreset).toMatch(/button:[\s\S]*?min-h-touch/)
    expect(ptPreset).toMatch(/pcInputText:[\s\S]*?size-touch/)
  })
})
