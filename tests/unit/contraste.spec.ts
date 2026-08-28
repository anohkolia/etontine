import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Contrôle de contraste AA sur toute la palette (acceptation T03).
 *
 * Les tokens sont lus **dans `main.css`**, pas recopiés ici : le test mesure la
 * couleur réellement livrée. Changer une valeur dans la feuille sans relancer
 * ce test fera tomber la suite, ce qui est exactement le but.
 *
 * Seuils WCAG 2.1 :
 * - 4.5:1 pour du texte de taille courante (critère 1.4.3, niveau AA) ;
 * - 3:1 pour les éléments d'interface porteurs de sens — bordure de champ,
 *   anneau de focus (critère 1.4.11).
 */
const css = readFileSync(
  fileURLToPath(new URL('../../app/assets/css/main.css', import.meta.url)),
  'utf8',
)

/** Les tokens de couleur déclarés dans `@theme`, tels quels. */
const tokens = Object.fromEntries(
  [...css.matchAll(/--color-([a-z-]+):\s*(#[0-9a-f]{6})\s*;/gi)]
    .map(([, name, hex]) => [name!, hex!.toLowerCase()]),
) as Record<string, string>

/** Luminance relative, définition WCAG 2.1. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
  const linear = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return 0.2126 * linear(r!) + 0.7152 * linear(g!) + 0.0722 * linear(b!)
}

function contrast(a: string, b: string): number {
  const [clair, sombre] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (clair! + 0.05) / (sombre! + 0.05)
}

/** [encre, fond, seuil, ce que la paire sert à afficher] */
const paires: ReadonlyArray<readonly [string, string, number, string]> = [
  ['ink', 'surface', 4.5, 'texte courant'],
  ['ink', 'surface-muted', 4.5, 'texte sur fond grisé'],
  ['ink-muted', 'surface', 4.5, 'texte secondaire'],
  ['ink-muted', 'surface-muted', 4.5, 'texte secondaire sur fond grisé'],
  ['ink-subtle', 'surface', 4.5, 'texte tertiaire'],
  ['ink-subtle', 'surface-muted', 4.5, 'texte tertiaire sur fond grisé'],

  ['brand', 'surface', 4.5, 'lien et texte de marque'],
  ['brand-ink', 'brand', 4.5, 'texte sur aplat de marque'],
  ['brand-ink', 'brand-strong', 4.5, 'texte sur aplat de marque foncé'],

  // Chaque statut, sur son propre fond de badge…
  ['due-ink', 'due-surface', 4.5, 'badge « À cotiser »'],
  ['late-ink', 'late-surface', 4.5, 'badge « En retard »'],
  ['declared-ink', 'declared-surface', 4.5, 'badge « Déclaré »'],
  ['confirmed-ink', 'confirmed-surface', 4.5, 'badge « Confirmé »'],
  ['disputed-ink', 'disputed-surface', 4.5, 'badge « Contesté »'],

  // …et sur fond blanc, car la même encre sert aux textes d'accompagnement.
  ['due-ink', 'surface', 4.5, 'texte de statut « À cotiser »'],
  ['late-ink', 'surface', 4.5, 'texte de statut « En retard »'],
  ['declared-ink', 'surface', 4.5, 'texte de statut « Déclaré »'],
  ['confirmed-ink', 'surface', 4.5, 'texte de statut « Confirmé »'],
  ['disputed-ink', 'surface', 4.5, 'texte de statut « Contesté »'],

  // Éléments d'interface : 3:1 suffit, mais il est obligatoire.
  ['ring', 'surface', 3, 'anneau de focus'],
  ['ring', 'surface-muted', 3, 'anneau de focus sur fond grisé'],
  ['line-strong', 'surface', 3, 'bordure de champ de saisie'],
]

describe('palette — contraste AA', () => {
  it('lit bien les tokens depuis main.css', () => {
    expect(Object.keys(tokens).length).toBeGreaterThanOrEqual(18)
    expect(tokens.surface).toBe('#ffffff')
  })

  it.each(paires)('%s sur %s atteint %s:1 — %s', (encre, fond, seuil) => {
    const a = tokens[encre]
    const b = tokens[fond]

    expect(a, `token --color-${encre} absent de main.css`).toBeDefined()
    expect(b, `token --color-${fond} absent de main.css`).toBeDefined()

    const rapport = contrast(a!, b!)
    expect(
      Number(rapport.toFixed(2)),
      `--color-${encre} (${a}) sur --color-${fond} (${b}) : ${rapport.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(seuil)
  })

  it('couvre toutes les encres de statut de la palette', () => {
    // Un statut ajouté à la palette sans être ajouté au tableau ci-dessus
    // passerait entre les mailles : on vérifie l'inverse aussi.
    const encresDeStatut = Object.keys(tokens).filter(t => t.endsWith('-ink') && !t.startsWith('brand'))
    const testees = new Set(paires.map(([encre]) => encre))

    for (const encre of encresDeStatut) {
      expect(testees.has(encre), `--color-${encre} n’est vérifiée par aucune paire`).toBe(true)
    }
  })

  it('n’admet aucune couleur hors format hexadécimal dans @theme', () => {
    // Le calcul de contraste lit de l'hexadécimal. Une valeur en oklch ou en
    // rgb() serait silencieusement ignorée par ce test — donc jamais vérifiée.
    const bloc = /@theme\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
    const couleurs = [...bloc.matchAll(/--color-[a-z-]+:\s*([^;]+);/gi)].map(m => m[1]!.trim())

    for (const valeur of couleurs) {
      expect(valeur, `valeur non hexadécimale dans @theme : ${valeur}`).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })
})
