import { TRANSITIONS } from '../../shared/schemas/index.ts'
import type { StateMachine } from '../../shared/schemas/index.ts'
import { apiError } from './errors.ts'

/**
 * Vérifie qu'une transition d'état est permise, en lisant les tables de
 * `shared/schemas`. **Toute transition absente de ces tables est interdite** et
 * renvoie `409 INVALID_TRANSITION` (docs/data-model.md §2).
 *
 * Règle 1 de CLAUDE.md : aucune transition ne se décide côté client. Le client
 * envoie une intention, le serveur la confronte à cette table **et** au rôle de
 * l'appelant. Un client qui poste `status: "confirmed"` doit être refusé, et
 * c'est ici que ça se joue.
 *
 * La table dit ce qui est *structurellement possible*. Les conditions métier —
 * « au moins trois membres actifs », « le confirmateur n'est pas le déclarant »
 * — restent à la charge du service appelant : elles dépendent de données, pas
 * du seul état de départ.
 */
export function canTransition(machine: StateMachine, from: string, to: string): boolean {
  const table = TRANSITIONS[machine] as Readonly<Record<string, readonly string[]>>
  return table[from]?.includes(to) ?? false
}

export function assertTransition(machine: StateMachine, from: string, to: string): void {
  if (canTransition(machine, from, to)) return

  const table = TRANSITIONS[machine] as Readonly<Record<string, readonly string[]>>
  const possibles = table[from]

  if (possibles === undefined) {
    throw apiError(
      'INVALID_TRANSITION',
      `État inconnu pour « ${machine} » : ${from}.`,
      { field: 'status' },
    )
  }

  // Le message dit ce qui *était* possible : sans cela, le diagnostic d'un
  // 409 en production oblige à rouvrir le code.
  const suite = possibles.length > 0
    ? `Depuis « ${from} », seuls ${possibles.map(p => `« ${p} »`).join(' ou ')} sont possibles.`
    : `« ${from} » est un état final.`

  throw apiError(
    'INVALID_TRANSITION',
    `Passage de « ${from} » à « ${to} » impossible. ${suite}`,
    { field: 'status' },
  )
}

/** Les états atteignables depuis un état donné — pour afficher les actions ouvertes. */
export function nextStates(machine: StateMachine, from: string): readonly string[] {
  const table = TRANSITIONS[machine] as Readonly<Record<string, readonly string[]>>
  return table[from] ?? []
}
