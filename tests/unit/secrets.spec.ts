import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * `.env.example` est **suivi par git**, et le dépôt est public : une valeur
 * réelle posée là s'en va chez tout le monde. C'est arrivé — une clé Brevo
 * vivante, arrêtée de justesse par la protection de GitHub, pas par nous.
 *
 * Ce fichier tient la règle : le gabarit documente les variables, il ne porte
 * jamais de secret. Le seul endroit où l'on colle une vraie valeur est `.env`,
 * que git ignore.
 */

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '../..')
const gabarit = readFileSync(join(RACINE, '.env.example'), 'utf8')
const ignore = readFileSync(join(RACINE, '.gitignore'), 'utf8')

/** Les variables dont le nom annonce un secret : leur valeur doit rester vide. */
const NOM_SENSIBLE = /KEY|SECRET|TOKEN|PASSWORD|CERT|CREDENTIAL/

/**
 * Les empreintes que laisse un copier-coller malheureux. Le nom de la variable
 * ne suffit pas : une clé peut atterrir n'importe où dans le fichier, dans un
 * commentaire d'exemple comme dans une affectation.
 */
const EMPREINTES_DE_CLE: Array<[string, RegExp]> = [
  ['Brevo', /xkeysib-[A-Za-z0-9]/],
  ['Resend', /\bre_[A-Za-z0-9]{16,}/],
  ['SendGrid', /\bSG\.[A-Za-z0-9_-]{16,}/],
  ['Stripe', /\bsk_(live|test)_[A-Za-z0-9]{16,}/],
  ['AWS', /\bAKIA[A-Z0-9]{16}\b/],
  ['clé privée', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
]

/** Les affectations du gabarit, guillemets retirés. Les lignes commentées ne comptent pas. */
function affectations(contenu: string): Array<{ nom: string, valeur: string }> {
  return contenu.split('\n')
    .map(ligne => /^([A-Z_0-9]+)=(.*)$/.exec(ligne))
    .filter((m): m is RegExpExecArray => m !== null)
    .map(m => ({ nom: m[1]!, valeur: m[2]!.trim().replace(/^["']|["']$/g, '') }))
}

describe('.env.example ne porte aucun secret', () => {
  it('laisse vide toute variable dont le nom annonce un secret', () => {
    const remplies = affectations(gabarit)
      .filter(({ nom, valeur }) => NOM_SENSIBLE.test(nom) && valeur.length > 0)
      .map(({ nom }) => nom)

    // Le message d'échec nomme la variable fautive : on veut savoir laquelle
    // sans avoir à ouvrir le fichier.
    expect(remplies).toEqual([])
  })

  it('ne contient l’empreinte d’aucune clé de fournisseur', () => {
    for (const [fournisseur, motif] of EMPREINTES_DE_CLE) {
      expect(gabarit, `empreinte de clé ${fournisseur} dans .env.example`).not.toMatch(motif)
    }
  })
})

describe('les vraies valeurs restent hors de git', () => {
  it('ignore `.env` et ses variantes', () => {
    const lignes = ignore.split('\n').map(l => l.trim())
    expect(lignes).toContain('.env')
    expect(lignes).toContain('.env.*')
  })
})
