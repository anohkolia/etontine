/**
 * Rôles dans une tontine — docs/data-model.md §3.
 *
 * Le rôle est **par tontine, jamais global** : un même compte préside ici et
 * cotise simplement ailleurs. La liste vit dans `shared/constants/` pour la
 * même raison que les icônes de tontine : les écrans l'affichent sans importer
 * Zod dans le lot client, et le schéma la reprend telle quelle.
 *
 * Chaque rôle porte une phrase qui dit **ce qu'il peut faire** : c'est ce que
 * le président doit lire avant de nommer quelqu'un. « Trésorier » seul ne dit
 * pas qu'on lui confie la confirmation des cotisations.
 */
export const MEMBERSHIP_ROLES = ['president', 'treasurer', 'auditor', 'member'] as const

export type MembershipRoleId = (typeof MEMBERSHIP_ROLES)[number]

export interface RolePresentation {
  readonly label: string
  readonly description: string
}

export const MEMBERSHIP_ROLE: Readonly<Record<MembershipRoleId, RolePresentation>> = {
  president: {
    label: 'Président',
    description: 'Invite, nomme le bureau, applique les amendes, prépare et verse le pot.',
  },
  treasurer: {
    label: 'Trésorier',
    description: 'Confirme les cotisations, enregistre les espèces, prépare le versement.',
  },
  auditor: {
    label: 'Censeur',
    description: 'Contre-valide les gros versements, tranche les contestations, rouvre une cotisation rejetée.',
  },
  member: {
    label: 'Membre',
    description: 'Cotise, lit le registre, signale une erreur.',
  },
}

/** Les rôles que le président peut attribuer d'un geste. La présidence se transfère. */
export const ROLES_NOMMABLES = ['member', 'treasurer', 'auditor'] as const satisfies readonly MembershipRoleId[]
