import type { PaymentChannel } from '../../shared/schemas/index.ts'

export interface BaremeCanal {
  percent: number
  fixed: number
  min: number
  max: number
}

export interface Bareme {
  configured: boolean
  wave: BaremeCanal
  orange: BaremeCanal
  mtn: BaremeCanal
  moov: BaremeCanal
  cash: BaremeCanal
}

export interface FraisEstimes {
  /** `null` quand la grille n'est pas renseignée : on n'invente pas un montant. */
  amount: number | null
  /** Qui les supporte : le membre sur son envoi, ou la tontine sur le pot. */
  bearer: 'member' | 'tontine'
  /** Ce que le membre doit réellement envoyer, frais compris s'ils sont à sa charge. */
  totalToSend: number
}

/**
 * Estime les frais d'envoi.
 *
 * **Aucun taux n'est écrit ici** (acceptation T14) : le barème vient de la
 * configuration d'exécution, destinée à être pilotée par le back-office. Les
 * opérateurs révisent leurs grilles sans préavis, et un taux figé dans le code
 * donnerait un montant faux le lendemain de la révision — un membre enverrait
 * alors trop peu, et sa cotisation apparaîtrait incomplète.
 *
 * Quand la grille n'est pas renseignée, on renvoie `null` plutôt qu'une
 * estimation inventée. L'interface dira « frais de ton opérateur en plus »,
 * ce qui est vrai, au lieu d'un chiffre qui ne l'est pas.
 *
 * Le résultat est toujours un **entier de FCFA** (règle 6) : on arrondit au
 * supérieur, parce qu'un membre qui envoie un franc de moins que le dû voit sa
 * cotisation refusée.
 */
export function estimerFrais(
  bareme: Bareme,
  canal: PaymentChannel,
  montant: number,
  bearer: 'member' | 'tontine',
): FraisEstimes {
  if (!bareme.configured) {
    return { amount: null, bearer, totalToSend: montant }
  }

  const grille = bareme[canal]
  const brut = (montant * grille.percent) / 100 + grille.fixed

  let frais = Math.ceil(brut)
  if (grille.min > 0) frais = Math.max(frais, grille.min)
  if (grille.max > 0) frais = Math.min(frais, grille.max)

  return {
    amount: frais,
    bearer,
    // Frais à la charge de la tontine : le membre envoie le montant nu, et la
    // tontine les absorbe sur le pot.
    totalToSend: bearer === 'member' ? montant + frais : montant,
  }
}

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
