/**
 * Masque de saisie ivoirien : `XX XX XX XX XX`.
 *
 * Les numéros se lisent et se dictent par paires en Côte d'Ivoire. Un champ qui
 * affiche `0707123456` d'un bloc oblige à recompter les chiffres ; groupé, il
 * se relit d'un coup d'œil, ce qui réduit les erreurs de saisie — donc les
 * codes envoyés au mauvais numéro.
 *
 * Le masque est **purement visuel** : la valeur transmise au serveur reste les
 * chiffres bruts, que Zod normalise ensuite en E.164 (règle 20).
 */
export function usePhoneMask() {
  /** `0707123456` → `07 07 12 34 56`. Tolère un préfixe `+225` déjà saisi. */
  function format(saisie: string): string {
    const chiffres = extraire(saisie)
    return chiffres.replace(/(\d{2})(?=\d)/g, '$1 ').trim()
  }

  /** Ne garde que les chiffres, en retirant l'indicatif s'il a été saisi. */
  function extraire(saisie: string): string {
    const brut = saisie.replace(/\D/g, '')
    const sansIndicatif = brut.startsWith('225') ? brut.slice(3) : brut
    return sansIndicatif.slice(0, 10)
  }

  /** Un numéro ivoirien complet fait dix chiffres. */
  function estComplet(saisie: string): boolean {
    return extraire(saisie).length === 10
  }

  return { format, extraire, estComplet }
}
