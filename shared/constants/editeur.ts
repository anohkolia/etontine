/**
 * L'éditeur de l'application — ce que les pages légales affichent.
 *
 * **À compléter avant la mise en production.** Chaque valeur laissée entre
 * crochets s'affiche telle quelle dans les mentions légales, les conditions
 * d'utilisation et la politique de confidentialité : c'est voulu, un trou
 * visible vaut mieux qu'une raison sociale inventée. Une seule source pour
 * les trois pages et le pied de la landing.
 */
export const EDITEUR = {
  /** Raison sociale ou nom de l'exploitant. */
  nom: '[Raison sociale de l’éditeur]',
  /** Forme juridique et capital, ex. « SARL au capital de 1 000 000 FCFA ». */
  forme: '[Forme juridique]',
  /** Numéro au registre du commerce et du crédit mobilier. */
  rccm: '[RCCM]',
  /** Siège social. */
  adresse: '[Adresse du siège], Abidjan, Côte d’Ivoire',
  /** Adresse de contact affichée aux membres. */
  email: '[contact@exemple.ci]',
  /** Responsable de la publication. */
  responsable: '[Nom du responsable de la publication]',
  /** Hébergeur de l'application. */
  hebergeur: '[Hébergeur — raison sociale et adresse]',
  /** Date de la dernière révision des textes. */
  revision: '15 septembre 2026',
} as const

/** Vrai tant qu'un champ est encore un gabarit entre crochets. */
export function editeurIncomplet(): boolean {
  return Object.values(EDITEUR).some(v => /^\[.*\]/.test(v))
}
