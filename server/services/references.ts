/**
 * Références courtes de cotisation.
 *
 * Ce module ne calcule **aucun frais**. Les frais d'envoi et de retrait sont
 * supportés par le membre dans les deux cas, et il en connaît l'ordre de
 * grandeur : afficher une estimation ajouterait un chiffre approximatif sur
 * l'écran où la charge mentale doit être la plus basse, sans rien lui
 * apprendre. Ce que le membre doit lire là, c'est le montant de sa cotisation,
 * le nom du titulaire et la référence — rien d'autre.
 */

/**
 * Référence courte d'une cotisation, au format `TON-XXXX`.
 *
 * Elle sert de commentaire dans l'application de paiement : le trésorier
 * retrouve ainsi quel envoi correspond à quelle cotisation, sans avoir à
 * croiser les heures et les montants. Sur un pot où tout le monde envoie la
 * même somme le même jour, c'est le seul moyen de les distinguer.
 *
 * Dérivée de l'identifiant, donc **stable** : un membre qui rouvre l'écran
 * retrouve la même référence que celle qu'il a déjà recopiée.
 */
export function referenceCourte(contributionId: string): string {
  const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // sans I, L, O, 0, 1
  let empreinte = 0

  for (const caractere of contributionId) {
    empreinte = (empreinte * 31 + caractere.charCodeAt(0)) >>> 0
  }

  let suffixe = ''
  for (let i = 0; i < 4; i++) {
    suffixe += ALPHABET[empreinte % ALPHABET.length]
    empreinte = Math.floor(empreinte / ALPHABET.length)
  }

  return `TON-${suffixe}`
}
