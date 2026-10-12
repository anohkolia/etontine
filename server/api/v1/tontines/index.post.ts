import { readBody } from 'h3'
import { tontineDraftInput } from '../../../../shared/schemas/index.ts'
import { useDb } from '../../../db/index.ts'
import { creerBrouillon } from '../../../services/tontines.ts'
import { requireKyc, requireUser } from '../../../utils/auth.ts'
import { validationError } from '../../../utils/errors.ts'

/**
 * Crée un brouillon de tontine.
 *
 * **Contradiction de spécification, tranchée ici et à confirmer.**
 * `docs/api-contract.md` exige le palier 2 sur cette route. Mais
 * `docs/cahier-des-charges.md` (§ Module 3, étape 0) et l'acceptation du
 * ticket T10 demandent que l'option « tontine ouverte » soit *visible et
 * grisée* pour qui n'a pas le palier 2 — ce qui suppose d'avoir atteint
 * l'étape 0 du wizard, donc de pouvoir commencer sans ce palier.
 *
 * Lecture retenue : « créer » au sens du palier 2 = **publier**. Le brouillon
 * s'ouvre dès le palier 1 ; le palier 2 est exigé pour le confirmer — le
 * publier — et pour en inviter les membres. Rien n'est visible d'autrui avant,
 * donc rien n'est exposé prématurément.
 *
 * L'accès « ouvert » qui motivait l'étape 0 a depuis été retiré : on ne
 * rejoint une tontine que par le lien de son organisateur. Le schéma refuse
 * désormais toute autre valeur que `private`.
 *
 * Le palier est vérifié **ici** et pas seulement à l'affichage : masquer un
 * bouton n'empêche personne d'appeler la route.
 */
export default defineEventHandler(async (event) => {
  const user = requireUser(event)
  requireKyc(user, 1)

  const parsed = tontineDraftInput.safeParse(await readBody(event))
  if (!parsed.success) throw validationError(parsed.error)

  const id = await creerBrouillon(useDb(), user.id, parsed.data)
  return { id, status: 'draft' as const }
})
