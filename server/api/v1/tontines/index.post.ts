import { readBody } from 'h3'
import { tontineDraftInput } from '../../../../shared/schemas/index.ts'
import { useDb } from '../../../db/index.ts'
import { creerBrouillon } from '../../../services/tontines.ts'
import { requireKyc, requireUser } from '../../../utils/auth.ts'
import { apiError, validationError } from '../../../utils/errors.ts'

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
 * privé s'ouvre dès le palier 1 ; le palier 2 est exigé pour choisir l'accès
 * ouvert et pour publier. Rien n'est visible d'autrui avant publication, donc
 * rien n'est exposé prématurément.
 *
 * Le palier est vérifié **ici** et pas seulement à l'affichage : masquer un
 * bouton n'empêche personne d'appeler la route.
 */
export default defineEventHandler(async (event) => {
  const user = requireUser(event)
  requireKyc(user, 1)

  const parsed = tontineDraftInput.safeParse(await readBody(event))
  if (!parsed.success) throw validationError(parsed.error)

  // Une tontine ouverte est publiquement visible : elle exige le même palier,
  // mais le contrôle est explicite pour que le message soit clair.
  if (parsed.data.access === 'open' && user.kycLevel < 2) {
    throw apiError(
      'KYC_REQUIRED',
      'Une tontine ouverte demande une pièce d’identité vérifiée.',
      { field: 'access', requiredLevel: 2 },
    )
  }

  const id = creerBrouillon(useDb(), user.id, parsed.data)
  return { id, status: 'draft' as const }
})
