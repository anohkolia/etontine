import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PAGES = fileURLToPath(new URL('../../app/pages', import.meta.url))
const LAYOUTS = fileURLToPath(new URL('../../app/layouts', import.meta.url))

function fichiers(dossier: string): string[] {
  return readdirSync(dossier).flatMap((f) => {
    const chemin = join(dossier, f)
    return statSync(chemin).isDirectory() ? fichiers(chemin) : [chemin]
  })
}

const pages = fichiers(PAGES)
  .filter(f => f.endsWith('.vue'))
  .map(chemin => ({ chemin, nom: chemin.slice(PAGES.length + 1), source: readFileSync(chemin, 'utf8') }))

const CINQ_ETATS = ['chargement', 'vide', 'erreur', 'hors-ligne', 'contenu'] as const

/**
 * Acceptation T27 : **chaque page implémente les cinq états** — chargement,
 * vide, erreur, hors-ligne, contenu (règle 14).
 *
 * Le contrôle porte sur une déclaration explicite en pied de fichier plutôt que
 * sur la seule présence des composants. Deux raisons :
 *
 * - certains états sont légitimement sans objet — un formulaire n'est jamais
 *   « vide », une page pré-rendue ne peut pas « échouer ». Exiger le composant
 *   partout produirait des états morts, et l'on prendrait l'habitude de les
 *   contourner ;
 * - écrire pourquoi un état est sans objet oblige à y avoir pensé. C'est
 *   exactement ce que la passe finale du ticket demande, et un test qui compte
 *   des composants ne l'obtiendrait pas.
 */
describe('les cinq états d’écran — acceptation T27', () => {
  it('couvre toutes les pages', () => {
    expect(pages.length).toBeGreaterThanOrEqual(18)
  })

  it.each(pages.map(p => p.nom))('%s déclare ses cinq états', (nom) => {
    const page = pages.find(p => p.nom === nom)!
    // On cherche le **commentaire** de pied, et non la première occurrence de
    // la formule : la page de démonstration porte un titre de section
    // homonyme, qui n'est pas une déclaration.
    const commentaires = [...page.source.matchAll(/<!--([\s\S]*?)-->/g)].map(m => m[1]!)
    const declaration = commentaires.find(c => /États d[’']écran/.test(c))

    expect(declaration, 'aucune déclaration d’états en pied de fichier').toBeDefined()

    // La page de démonstration technique est hors périmètre, et le dit
    // explicitement. La marque est courte à dessein : une formule plus longue
    // se ferait couper par un retour à la ligne du commentaire.
    if (declaration!.includes('hors périmètre')) return

    for (const etat of CINQ_ETATS) {
      expect(declaration!, `état « ${etat} » non déclaré`).toContain(etat)
    }
  })

  it('les écrans qui chargent des données ont un squelette et une reprise', () => {
    // Dès qu'une page appelle l'API au montage, l'attente et l'échec sont des
    // situations réelles : elles méritent un composant, pas une justification.
    const manquants: string[] = []

    for (const page of pages) {
      const chargeDesDonnees = /onMounted\(charger\)|await useFetch/.test(page.source)
      if (!chargeDesDonnees) continue

      if (!page.source.includes('LoadingSkeleton')) manquants.push(`${page.nom} : squelette`)
      if (!/ErrorState|EmptyState/.test(page.source)) manquants.push(`${page.nom} : erreur`)
    }

    expect(manquants, manquants.join(' · ')).toEqual([])
  })

  it('l’état hors-ligne est porté par la mise en page ou par la page elle-même', () => {
    // Une coupure réseau concerne toute l'application : l'oublier sur un écran
    // laisserait le membre croire que sa déclaration est partie.
    const layoutApp = readFileSync(join(LAYOUTS, 'app.vue'), 'utf8')
    expect(layoutApp).toContain('OfflineBanner')

    const manquants = pages
      .filter(p => /layout: false/.test(p.source))
      // La landing, l'aide et la démonstration n'ont rien à envoyer : une
      // coupure n'y change rien.
      .filter(p => !['index.vue', 'aide.vue', 'demo.vue'].includes(p.nom))
      .filter(p => !p.source.includes('OfflineBanner'))
      .map(p => p.nom)

    expect(manquants, `sans bandeau hors-ligne : ${manquants.join(', ')}`).toEqual([])
  })
})
