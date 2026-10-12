/**
 * Pourquoi l'on arrive sur l'écran de vérification d'identité.
 *
 * L'écran le dit d'abord. Sans ce mot, l'organisateur qui voulait valider sa
 * tontine — ou en inviter les membres — tombait sur un formulaire de pièces
 * sans savoir ce qui l'y avait mené.
 */
export const MOTIF_VALIDER_TONTINE = 'valider-tontine'
export const MOTIF_INVITER = 'inviter'

export type MotifIdentite = typeof MOTIF_VALIDER_TONTINE | typeof MOTIF_INVITER

/**
 * L'adresse de la vérification d'identité : le motif, que l'écran affiche, et
 * le retour, où il ramène une fois l'identité vérifiée.
 */
export function adresseVerificationIdentite(motif: MotifIdentite, retour: string) {
  return { path: '/app/profil/identite', query: { redirect: retour, motif } }
}
