import { getRouterParam, setHeader } from 'h3'
import { and, eq, inArray } from 'drizzle-orm'
import { useDb } from '../../../../../db/index.ts'
import { memberships } from '../../../../../db/schema.ts'
import { requireUser } from '../../../../../utils/auth.ts'
import { apiError } from '../../../../../utils/errors.ts'
import { lirePiece } from '../../../../../utils/fichiers.ts'

/**
 * Sert une capture de paiement.
 *
 * Deux personnes ont le droit de la voir : **celui qui l'a déposée**, et le
 * **bureau d'une tontine qu'ils partagent** — c'est lui qui doit rapprocher
 * l'envoi. Personne d'autre : une capture de paiement porte un numéro, un
 * montant et parfois un nom.
 *
 * Un fichier introuvable et un fichier interdit renvoient la même chose. La
 * différence dirait à un curieux quelles pièces existent.
 */
export default defineEventHandler(async (event) => {
  const user = requireUser(event)
  const proprietaire = getRouterParam(event, 'userId')
  const nom = getRouterParam(event, 'fichier')

  if (!proprietaire || !nom) throw apiError('NOT_FOUND', 'Pièce introuvable.')

  if (proprietaire !== user.id) {
    // Le bureau d'une tontine partagée : on cherche une adhésion commune où
    // l'appelant est trésorier ou président.
    const db = useDb()

    const siennes = db
      .select({ tontineId: memberships.tontineId })
      .from(memberships)
      .where(and(
        eq(memberships.userId, user.id),
        eq(memberships.status, 'active'),
        inArray(memberships.role, ['treasurer', 'president']),
      ))
      .all()
      .map(m => m.tontineId)

    const commune = siennes.length > 0
      && db
        .select({ id: memberships.id })
        .from(memberships)
        .where(and(
          eq(memberships.userId, proprietaire),
          inArray(memberships.tontineId, siennes),
        ))
        .all()
        .length > 0

    if (!commune) throw apiError('NOT_FOUND', 'Pièce introuvable.')
  }

  const piece = await lirePiece(proprietaire, nom)
  if (!piece) throw apiError('NOT_FOUND', 'Pièce introuvable.')

  setHeader(event, 'content-type', piece.type)
  // Jamais de cache partagé : une pièce n'est visible que de certaines personnes.
  setHeader(event, 'cache-control', 'private, max-age=300')
  setHeader(event, 'content-disposition', 'inline')
  // Une image déposée par un tiers ne doit jamais être interprétée autrement.
  setHeader(event, 'x-content-type-options', 'nosniff')

  return piece.contenu
})
