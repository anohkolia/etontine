import { useDb } from '../../../../db/index.ts'
import { derniereDecision, etatAbonnement } from '../../../../services/abonnement.ts'
import { requireUser } from '../../../../utils/auth.ts'

/**
 * L'état de l'abonnement du président : palier, quotas, consommation réelle.
 *
 * **Tout est calculé ici** (règle 2). Le client n'additionne pas ses tontines
 * et ne compare aucun effectif à une limite : il affiche ce que le serveur lui
 * donne. Sinon, deux endroits calculeraient le même quota, et le jour où ils
 * divergeraient, c'est l'écran qui aurait tort en silence.
 */
export default defineEventHandler((event) => {
  const user = requireUser(event)
  const db = useDb()

  const etat = etatAbonnement(db, user)
  const decision = derniereDecision(db, user.id)

  return {
    ...etat,
    // La dernière décision rendue, pour que le motif d'un refus soit lisible
    // par la personne concernée. Un refus sans raison est une impasse.
    derniereDecision: decision
      ? {
          status: decision.status,
          tier: decision.tier,
          note: decision.reviewNote,
          reviewedAt: decision.reviewedAt?.toISOString() ?? null,
        }
      : null,
  }
})
