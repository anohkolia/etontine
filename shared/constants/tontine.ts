/**
 * Icônes de tontine.
 *
 * La liste vit ici et **pas** dans `shared/schemas/` bien qu'elle serve à
 * construire l'énumération Zod : un `import { tontineEmoji } from
 * '#shared/schemas'` dans une page ferait entrer Zod dans le lot client, pour
 * huit caractères. Aucune page n'importe de valeur depuis les schémas —
 * seulement des types — et cette liste ne doit pas être la première exception.
 *
 * Le schéma la reprend telle quelle (`z.enum(TONTINE_EMOJIS)`) : la source de
 * vérité reste unique, et le serveur valide contre exactement ce que le wizard
 * propose.
 *
 * Reprise du sélecteur d'icône du wizard du template. L'intérêt n'est pas
 * décoratif : sur ce terrain, reconnaître sa tontine à son image est plus
 * rapide que lire son nom (§7 du cahier des charges, faible littératie).
 */
export const TONTINE_EMOJIS = ['🧺', '🚕', '🏡', '💼', '🎓', '👗', '🍲', '⚽'] as const

export type TontineEmoji = (typeof TONTINE_EMOJIS)[number]
