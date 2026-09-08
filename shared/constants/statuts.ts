import type { z } from 'zod'
import type {
  contributionStatus,
  membershipStatus,
  paymentChannel,
  payoutStatus,
  roundStatus,
  tontineStatus,
} from '../schemas'

/**
 * Présentation des statuts — la source unique du couple mot / icône / couleur.
 *
 * Règle 10 de CLAUDE.md : **jamais d'information portée par la couleur seule**.
 * Un statut se présente donc toujours par ses trois attributs à la fois. Le
 * type l'impose : il n'existe pas de statut sans mot ni sans icône, et
 * `<StatusBadge>` rend les trois systématiquement.
 *
 * Les icônes sont choisies pour être distinguables **par la forme**. Un membre
 * qui ne perçoit pas la différence entre l'ambre et le vert doit pouvoir lire
 * l'état d'une cotisation : le triangle d'alerte et la coche ronde ne se
 * confondent pas, quelle que soit la vision des couleurs.
 *
 * Les mots suivent le vocabulaire imposé (règles 8 et 9) : on cotise, on
 * déclare, on confirme, on prend la main. On n'encaisse pas, on ne crédite pas.
 */
export interface StatusPresentation {
  /** Le mot affiché à l'écran. Jamais abrégé, jamais remplacé par un point de couleur. */
  readonly label: string
  /** Nom d'icône Lucide, résolu localement par @nuxt/icon — aucun appel réseau. */
  readonly icon: string
  /** Classe de fond, issue des tokens de la palette. */
  readonly surface: string
  /** Classe d'encre. Le contraste avec `surface` est vérifié par test. */
  readonly ink: string
}

type Presentation<T extends string> = Readonly<Record<T, StatusPresentation>>

/**
 * Cotisations. Le bleu de « Déclaré » est délibéré : un paiement déclaré n'est
 * pas confirmé, il attend le trésorier. Le vert le ferait passer pour acquis (T15).
 */
export const CONTRIBUTION_STATUS: Presentation<z.infer<typeof contributionStatus>> = {
  due: { label: 'À cotiser', icon: 'lucide:circle-dashed', surface: 'bg-due-surface', ink: 'text-due-ink' },
  late: { label: 'En retard', icon: 'lucide:triangle-alert', surface: 'bg-late-surface', ink: 'text-late-ink' },
  declared: { label: 'Déclaré', icon: 'lucide:clock', surface: 'bg-declared-surface', ink: 'text-declared-ink' },
  confirmed: { label: 'Confirmé', icon: 'lucide:circle-check', surface: 'bg-confirmed-surface', ink: 'text-confirmed-ink' },
  disputed: { label: 'Contesté', icon: 'lucide:octagon-alert', surface: 'bg-disputed-surface', ink: 'text-disputed-ink' },
}

/** Tours. « Prendre la main » est le terme métier ; on ne dit pas « ramassage ». */
export const ROUND_STATUS: Presentation<z.infer<typeof roundStatus>> = {
  pending: { label: 'À venir', icon: 'lucide:calendar', surface: 'bg-due-surface', ink: 'text-due-ink' },
  collecting: { label: 'Cotisations en cours', icon: 'lucide:hand-coins', surface: 'bg-declared-surface', ink: 'text-declared-ink' },
  payout_pending: { label: 'Pot à verser', icon: 'lucide:package', surface: 'bg-late-surface', ink: 'text-late-ink' },
  closed: { label: 'Tour clos', icon: 'lucide:circle-check', surface: 'bg-confirmed-surface', ink: 'text-confirmed-ink' },
}

/** Versements du pot. */
export const PAYOUT_STATUS: Presentation<z.infer<typeof payoutStatus>> = {
  prepared: { label: 'Préparé', icon: 'lucide:file-pen', surface: 'bg-due-surface', ink: 'text-due-ink' },
  counter_validated: { label: 'Contre-validé', icon: 'lucide:user-check', surface: 'bg-declared-surface', ink: 'text-declared-ink' },
  declared: { label: 'Déclaré', icon: 'lucide:clock', surface: 'bg-declared-surface', ink: 'text-declared-ink' },
  acknowledged: { label: 'Reçu', icon: 'lucide:circle-check', surface: 'bg-confirmed-surface', ink: 'text-confirmed-ink' },
  disputed: { label: 'Contesté', icon: 'lucide:octagon-alert', surface: 'bg-disputed-surface', ink: 'text-disputed-ink' },
}

/**
 * Membres. `defaulted` reste interne au bureau : le modèle de données précise
 * qu'il n'entraîne aucune publication publique.
 */
export const MEMBERSHIP_STATUS: Presentation<z.infer<typeof membershipStatus>> = {
  invited: { label: 'Invité', icon: 'lucide:mail', surface: 'bg-due-surface', ink: 'text-due-ink' },
  pending_approval: { label: 'En attente d’accord', icon: 'lucide:clock', surface: 'bg-declared-surface', ink: 'text-declared-ink' },
  active: { label: 'Actif', icon: 'lucide:circle-check', surface: 'bg-confirmed-surface', ink: 'text-confirmed-ink' },
  left: { label: 'Parti', icon: 'lucide:log-out', surface: 'bg-due-surface', ink: 'text-due-ink' },
  defaulted: { label: 'Défaillant', icon: 'lucide:user-x', surface: 'bg-disputed-surface', ink: 'text-disputed-ink' },
}

/** Tontines. */
export const TONTINE_STATUS: Presentation<z.infer<typeof tontineStatus>> = {
  draft: { label: 'Brouillon', icon: 'lucide:file-pen', surface: 'bg-due-surface', ink: 'text-due-ink' },
  open: { label: 'Ouverte aux membres', icon: 'lucide:door-open', surface: 'bg-declared-surface', ink: 'text-declared-ink' },
  running: { label: 'En cours', icon: 'lucide:play', surface: 'bg-confirmed-surface', ink: 'text-confirmed-ink' },
  closed: { label: 'Terminée', icon: 'lucide:flag', surface: 'bg-due-surface', ink: 'text-due-ink' },
  archived: { label: 'Archivée', icon: 'lucide:archive', surface: 'bg-due-surface', ink: 'text-due-ink' },
}

/**
 * Contestations ouvertes sur une écriture du registre.
 *
 * Deux états seulement : ouverte, ou close avec sa conclusion. Le triplet
 * mot + icône + couleur vaut ici comme ailleurs — une contestation signalée
 * par la seule couleur serait invisible à qui distingue mal le rouge.
 */
export const DISPUTE_STATUS: Presentation<'open' | 'resolved'> = {
  open: { label: 'À examiner', icon: 'lucide:octagon-alert', surface: 'bg-disputed-surface', ink: 'text-disputed-ink' },
  resolved: { label: 'Close', icon: 'lucide:circle-check', surface: 'bg-confirmed-surface', ink: 'text-confirmed-ink' },
}

/** Toutes les tables, pour les contrôles d'exhaustivité et la page de démonstration. */
export const ALL_STATUS_TABLES = {
  contribution: CONTRIBUTION_STATUS,
  round: ROUND_STATUS,
  payout: PAYOUT_STATUS,
  membership: MEMBERSHIP_STATUS,
  tontine: TONTINE_STATUS,
  dispute: DISPUTE_STATUS,
} as const

/** Les machines à états présentables. */
export type StatusKind = keyof typeof ALL_STATUS_TABLES

/** Les statuts valides pour une machine donnée — utilisé pour typer `<StatusBadge>`. */
export type StatusOf<K extends StatusKind> = keyof (typeof ALL_STATUS_TABLES)[K] & string

/**
 * Présentation d'un statut donné.
 *
 * TypeScript ne sait pas résoudre `ALL_STATUS_TABLES[kind][status]` quand
 * `kind` est un paramètre générique : le double indice sur un type générique
 * lui échappe. La conversion est donc isolée ici, une fois, pendant que la
 * signature garde la sûreté au point d'appel — `statusPresentation('round',
 * 'confirmed')` ne compile pas, `confirmed` n'étant pas un statut de tour.
 */
export function statusPresentation<K extends StatusKind>(
  kind: K,
  status: StatusOf<K>,
): StatusPresentation {
  const table = ALL_STATUS_TABLES[kind] as Readonly<Record<string, StatusPresentation>>
  const presentation = table[status]

  if (!presentation) {
    throw new RangeError(`Statut inconnu pour « ${kind} » : ${status}`)
  }
  return presentation
}

/** Tous les noms d'icônes utilisés par les statuts, sans doublon. */
export const STATUS_ICONS: readonly string[] = [
  ...new Set(
    Object.values(ALL_STATUS_TABLES).flatMap(table =>
      Object.values(table).map(p => p.icon),
    ),
  ),
].sort()

/**
 * Canaux de paiement — mot, icône, couleurs.
 *
 * Repris des pastilles d'opérateur du template, avec une correction : le
 * template pose du blanc sur l'orange d'Orange Money (3.12:1) et du bleu nuit
 * sur le jaune MTN (1.53:1). Une pastille de canal se lit à côté d'un montant,
 * dans un registre qu'un membre relit pour vérifier un envoi — elle doit être
 * lisible, pas décorative. D'où le couple fond pâle / encre foncée, comme
 * pour les statuts, vérifié par `tests/unit/contraste.spec.ts`.
 *
 * Les couleurs d'opérateur restent reconnaissables (le bleu Wave, l'orange
 * d'Orange, le jaune MTN) sans jamais porter l'information seules : le nom du
 * canal est toujours écrit à côté (règle 10).
 */
export const PAYMENT_CHANNEL: Presentation<z.infer<typeof paymentChannel>> = {
  wave: { label: 'Wave', icon: 'lucide:waves', surface: 'bg-wave-surface', ink: 'text-wave-ink' },
  orange: { label: 'Orange Money', icon: 'lucide:smartphone', surface: 'bg-orange-surface', ink: 'text-orange-ink' },
  mtn: { label: 'MTN MoMo', icon: 'lucide:smartphone', surface: 'bg-mtn-surface', ink: 'text-mtn-ink' },
  moov: { label: 'Moov Money', icon: 'lucide:smartphone', surface: 'bg-moov-surface', ink: 'text-moov-ink' },
  cash: { label: 'Espèces', icon: 'lucide:banknote', surface: 'bg-cash-surface', ink: 'text-cash-ink' },
}

/** Présentation d'un canal. Lève sur un canal inconnu, comme les statuts. */
export function channelPresentation(
  channel: z.infer<typeof paymentChannel>,
): StatusPresentation {
  const presentation = PAYMENT_CHANNEL[channel]
  if (!presentation) throw new RangeError(`Canal inconnu : ${channel}`)
  return presentation
}
