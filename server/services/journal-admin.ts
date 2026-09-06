import { randomUUID } from 'node:crypto'
import type { useDb } from '../db/index.ts'
import { adminAudit } from '../db/schema.ts'

type Db = ReturnType<typeof useDb>

export interface Administrateur {
  id: string
  phone: string
}

/**
 * Consigne une action d'administration.
 *
 * Systématique, et non laissée à la discrétion de l'appelant : approuver une
 * pièce d'identité, c'est autoriser quelqu'un à collecter l'argent d'un
 * groupe. Une décision de cette portée doit avoir un auteur et une date, même
 * — surtout — quand elle est bonne. Le même raisonnement vaut pour un palier
 * d'abonnement posé à la main : il lève un quota, il doit avoir un signataire.
 *
 * Le journal est **append-only**, comme le registre : ni mise à jour ni
 * suppression.
 */
export function journaliser(
  db: Db,
  admin: Administrateur,
  action: string,
  targetUserId: string | null,
  payload: Record<string, unknown>,
): void {
  db.insert(adminAudit).values({
    id: randomUUID(),
    actorId: admin.id,
    // Le numéro est figé au moment de l'écriture : si l'administrateur change
    // de numéro plus tard, le journal doit rester lisible tel qu'il était.
    actorPhone: admin.phone,
    action,
    targetUserId,
    payload,
  }).run()
}
