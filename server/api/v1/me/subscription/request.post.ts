import { readBody } from 'h3'
import { subscriptionRequestInput } from '../../../../../shared/schemas/index.ts'
import { useDb } from '../../../../db/index.ts'
import { creerDemande } from '../../../../services/abonnement.ts'
import { requireUser } from '../../../../utils/auth.ts'
import { validationError } from '../../../../utils/errors.ts'
import { withIdempotency } from '../../../../utils/idempotency.ts'

/**
 * Demande de passage à un palier payant.
 *
 * L'application **n'encaisse rien**, et cette route n'y change rien : elle
 * enregistre une intention, que le règlement suivra hors application. Le
 * prélèvement récurrent n'est pas garanti sur les rails ivoiriens, et aucune
 * ligne de code ne doit laisser croire le contraire.
 *
 * `Idempotency-Key` est exigée quand même (règle 4) : la demande engage une
 * somme, et un réseau qui coupe pendant l'envoi ne doit pas produire deux
 * dossiers pour le même mois.
 *
 * Le prix n'est **jamais** lu dans le corps de la requête : il vient de la
 * grille, côté serveur.
 */
export default defineEventHandler(async (event) => {
  const user = requireUser(event)

  const parsed = subscriptionRequestInput.safeParse(await readBody(event))
  if (!parsed.success) throw validationError(parsed.error)

  return withIdempotency(event, user.id, parsed.data, () =>
    creerDemande(useDb(), user.id, parsed.data))
})
