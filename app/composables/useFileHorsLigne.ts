import {
  enfiler, lireFile, majMutation, retirer,
} from '../utils/file-hors-ligne'
import type { MutationEnAttente } from '../utils/file-hors-ligne'

/** Au-delà, on cesse de réessayer et on montre l'échec au membre. */
const TENTATIVES_MAX = 5

/**
 * File d'attente des mutations, vidée au retour du réseau.
 *
 * Le principe : **on ne perd jamais une saisie**. Un membre qui déclare son
 * paiement dans un tramway sans réseau ne doit pas avoir à recommencer — et
 * surtout, ne doit pas croire que c'est passé alors que non. L'application
 * enregistre l'intention, le dit clairement, et l'envoie au retour du réseau.
 *
 * Le rejeu est sans danger parce que chaque intention porte son
 * `Idempotency-Key`, fabriquée à la saisie : le serveur reconnaît un rejeu et
 * renvoie la réponse d'origine sans rien recréer (règle 4).
 */
export function useFileHorsLigne() {
  const enAttente = useState<MutationEnAttente[]>('file-hors-ligne', () => [])
  const envoiEnCours = useState('file-hors-ligne-envoi', () => false)

  async function rafraichir() {
    enAttente.value = await lireFile()
  }

  /**
   * Envoie une mutation, ou l'enfile si le réseau manque.
   *
   * Renvoie `true` si l'appel est parti, `false` s'il a été mis en attente.
   */
  async function envoyerOuEnfiler(mutation: Omit<MutationEnAttente, 'id' | 'createdAt' | 'tentatives'>): Promise<boolean> {
    const complete: MutationEnAttente = {
      ...mutation,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      tentatives: 0,
    }

    if (!navigator.onLine) {
      await enfiler(complete)
      await rafraichir()
      return false
    }

    try {
      await $fetch(complete.url, {
        method: complete.method,
        headers: { 'Idempotency-Key': complete.idempotencyKey },
        body: complete.body as Record<string, unknown>,
      })
      return true
    }
    catch (erreur) {
      // Une erreur métier (4xx) ne se rejoue pas : la remettre en file la
      // ferait échouer indéfiniment. Seule une panne de transport est enfilée.
      const statut = (erreur as { statusCode?: number }).statusCode
      if (statut && statut >= 400 && statut < 500) throw erreur

      await enfiler(complete)
      await rafraichir()
      return false
    }
  }

  /** Vide la file. Appelée au retour du réseau et au démarrage. */
  async function vider(): Promise<{ envoyees: number, echouees: number }> {
    if (envoiEnCours.value || !navigator.onLine) return { envoyees: 0, echouees: 0 }

    envoiEnCours.value = true
    let envoyees = 0
    let echouees = 0

    try {
      for (const mutation of await lireFile()) {
        try {
          await $fetch(mutation.url, {
            method: mutation.method,
            headers: { 'Idempotency-Key': mutation.idempotencyKey },
            body: mutation.body as Record<string, unknown>,
          })
          await retirer(mutation.id)
          envoyees++
        }
        catch (erreur) {
          const statut = (erreur as { statusCode?: number }).statusCode

          // Refusée par le serveur pour une raison métier : inutile d'insister.
          // On la retire de la file, mais le membre doit être prévenu.
          if (statut && statut >= 400 && statut < 500) {
            await retirer(mutation.id)
            echouees++
            continue
          }

          const tentatives = mutation.tentatives + 1
          if (tentatives >= TENTATIVES_MAX) {
            await retirer(mutation.id)
            echouees++
          }
          else {
            await majMutation({ ...mutation, tentatives })
          }
        }
      }
    }
    finally {
      envoiEnCours.value = false
      await rafraichir()
    }

    return { envoyees, echouees }
  }

  return { enAttente, envoiEnCours, envoyerOuEnfiler, vider, rafraichir }
}
