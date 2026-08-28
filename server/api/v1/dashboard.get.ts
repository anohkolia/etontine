import { useDb } from '../../db/index.ts'
import { tableauDeBord } from '../../services/tableau-de-bord.ts'
import { requireUser } from '../../utils/auth.ts'

/**
 * Tout le tableau de bord, en **un seul appel** (acceptation T21).
 *
 * L'alternative — une requête par tontine, puis une par tour — donnerait dix
 * allers-retours là où un seul suffit. Sur un téléphone en 3G au marché, c'est
 * la différence entre un écran qui s'affiche et un membre qui referme
 * l'application.
 */
export default defineEventHandler((event) => {
  const user = requireUser(event)
  return tableauDeBord(useDb(), user.id)
})
