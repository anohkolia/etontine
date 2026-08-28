/**
 * Un numéro ivoirien valide, différent à chaque appel.
 *
 * Les demandes de code sont limitées à trois par dix minutes **et par numéro**.
 * Deux profils Playwright qui tournent en parallèle sur le même numéro se
 * heurtent donc à la limitation — et la base de développement conserve
 * l'historique d'un lancement à l'autre. Un numéro neuf par test isole chaque
 * scénario, sans rien désactiver côté serveur : la limitation reste vérifiée
 * par les tests unitaires, où l'horloge est maîtrisée.
 */
let compteur = 0

export function numeroDeTest(): string {
  compteur++
  const graine = (Date.now() % 100_000) * 100 + (compteur % 100)
  return `07${String(graine).padStart(8, '0').slice(-8)}`
}

/** Le même numéro, au format affiché par le masque. */
export function numeroFormate(numero: string): string {
  return numero.replace(/(\d{2})(?=\d)/g, '$1 ').trim()
}
