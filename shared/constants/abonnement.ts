/**
 * La grille d'abonnement — source unique, client et serveur.
 *
 * Les valeurs vivent ici et **pas** dans `shared/schemas/` pour la même raison
 * que `TONTINE_EMOJIS` : `/tarifs` est une page publique, pré-rendue, souvent
 * le premier contact sur une connexion facturée à la donnée. Un
 * `import … from '#shared/schemas'` y ferait entrer Zod dans le lot client pour
 * afficher trois prix. Le schéma reprend l'énumération telle quelle
 * (`z.enum(PLAN_TIERS)`), la vérité reste donc unique.
 *
 * Quatre choses sont arbitrées et ne se redécident pas dans le code :
 *
 * 1. **Un forfait, jamais une commission.** Prélever un pourcentage sur les
 *    cotisations rapprocherait l'éditeur du statut d'établissement de paiement.
 * 2. **La limite porte sur les deux axes à la fois** : tontines actives *et*
 *    membres par tontine.
 * 3. **Le président paie de sa poche.** La caisse n'est jamais débitée, et
 *    aucun mécanisme de l'application ne permet de la faire payer (règle 5).
 * 4. **Aucune fonctionnalité de sécurité derrière le paywall.** Le registre,
 *    les preuves, les reçus, le contrôle d'intégrité et le procès-verbal PDF
 *    restent gratuits à tous les paliers. Vendre la confiance se retourne
 *    toujours contre l'éditeur — c'est `AVANTAGES_COMMUNS` plus bas, et cette
 *    liste ne migre jamais vers un palier payant.
 */

export const PLAN_TIERS = ['free', 'standard', 'plus'] as const
export type PlanTier = (typeof PLAN_TIERS)[number]

/** Les paliers qu'on peut demander. On ne « demande » pas le palier gratuit. */
export const PAID_TIERS = ['standard', 'plus'] as const
export type PaidTier = (typeof PAID_TIERS)[number]

export const PLAN_PERIODICITIES = ['monthly', 'yearly'] as const
export type PlanPeriodicity = (typeof PLAN_PERIODICITIES)[number]

/**
 * Une limite à `null` est **illimitée**. Pas de `Infinity` : la valeur
 * traverse JSON, où `Infinity` devient `null` en silence — autant que ce soit
 * `null` des deux côtés et que le sens soit porté par le type.
 */
export type Limite = number | null

export interface Palier {
  readonly id: PlanTier
  readonly nom: string
  /** En FCFA entiers, par mois. Zéro pour le palier gratuit (règle 6). */
  readonly prixMensuel: number
  /** En FCFA entiers, par an. `MOIS_OFFERTS` mois de moins que douze mensualités. */
  readonly prixAnnuel: number
  readonly tontinesActives: Limite
  readonly membresParTontine: Limite
  /** Ce que le palier ajoute, en une phrase par ligne. Jamais de sécurité ici. */
  readonly apports: readonly string[]
}

/** L'abonnement annuel se paie dix mois. */
export const MOIS_OFFERTS = 2

export const PALIERS = [
  {
    id: 'free',
    nom: 'Gratuit',
    prixMensuel: 0,
    prixAnnuel: 0,
    tontinesActives: 1,
    membresParTontine: 15,
    apports: [
      'Une tontine à la fois, jusqu’à 15 membres',
      'Tout ce qui touche à la confiance, sans rien payer',
    ],
  },
  {
    id: 'standard',
    nom: 'Standard',
    prixMensuel: 7_500,
    prixAnnuel: 75_000,
    tontinesActives: 5,
    membresParTontine: 40,
    apports: [
      'Jusqu’à 5 tontines en cours en même temps',
      'Jusqu’à 40 membres par tontine',
    ],
  },
  {
    id: 'plus',
    nom: 'Plus',
    prixMensuel: 10_000,
    prixAnnuel: 100_000,
    tontinesActives: null,
    membresParTontine: null,
    apports: [
      'Tontines en cours sans limite de nombre',
      'Membres sans limite par tontine',
    ],
  },
] as const satisfies readonly Palier[]

/**
 * Accès par identifiant. Écrit à la main plutôt que dérivé par
 * `Object.fromEntries` : le type doit garantir qu'il existe une entrée pour
 * **chaque** palier, ce qu'une construction dynamique ne sait pas prouver.
 * Ajouter un palier à `PLAN_TIERS` sans l'ajouter ici casse la compilation,
 * ce qui est exactement le comportement voulu.
 */
export const PALIER_PAR_ID: Record<PlanTier, Palier> = {
  free: PALIERS[0],
  standard: PALIERS[1],
  plus: PALIERS[2],
}

/**
 * Gratuit à tous les paliers, y compris le palier gratuit. La liste est
 * affichée telle quelle sur `/tarifs`, au-dessus de la grille : c'est la
 * réponse à « qu'est-ce que je perds si je ne paie pas ». Rien.
 */
export const AVANTAGES_COMMUNS = [
  'Le registre complet, lisible par tous les membres',
  'Les preuves de paiement et les reçus vérifiables',
  'Le contrôle d’intégrité du registre',
  'Le procès-verbal de fin de cycle en PDF',
  'Les rappels d’échéance et les relances',
] as const

/**
 * `true` si la limite est franchie. Une limite `null` ne l'est jamais.
 *
 * `effectif` est ce qui existe déjà, `ajout` ce qu'on veut ajouter : la
 * question posée est toujours « après cette action, dépasse-t-on ? », jamais
 * « dépasse-t-on en ce moment ». C'est ce qui rend le contrôle non rétroactif —
 * l'existant au-dessus de la limite n'est pas cassé, il est seulement gelé.
 */
export function depasse(limite: Limite, effectif: number, ajout = 1): boolean {
  return limite !== null && effectif + ajout > limite
}

/** `null` → « illimité ». Sert aux gabarits, qui n'ont pas à tester le type. */
export function libelleLimite(limite: Limite): string {
  return limite === null ? 'illimité' : String(limite)
}
