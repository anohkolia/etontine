import { randomUUID } from 'node:crypto'
import { inArray } from 'drizzle-orm'
import { useDb } from './index.ts'
import { users } from './schema.ts'
import { numerosAdministrateurs } from '../utils/admin.ts'

type Db = ReturnType<typeof useDb>

/**
 * Crée le compte des administrateurs listés dans `NUXT_ADMIN_PHONES`.
 *
 * Le back-office **ne crée aucun compte** : un numéro inconnu n'y a rien à
 * faire, et laisser un point d'entrée d'administration créer des comptes serait
 * exactement le genre de commodité qui finit mal. Il faut donc que la ligne
 * existe avant la première connexion — c'est ce que fait cette commande.
 *
 * Elle n'accorde **aucun droit** : les droits viennent de la liste blanche en
 * variable d'environnement, jamais de la base. Créer la ligne ne fait
 * qu'ouvrir la porte à quelqu'un qui a déjà la clé.
 *
 * Idempotente : la relancer ne crée rien de neuf.
 */
export function creerComptesAdministrateurs(db: Db = useDb()): { crees: string[], existants: string[] } {
  const numeros = numerosAdministrateurs()
  if (numeros.length === 0) return { crees: [], existants: [] }

  const deja = db
    .select({ phone: users.phone })
    .from(users)
    .where(inArray(users.phone, numeros))
    .all()
    .map(u => u.phone)

  const crees: string[] = []

  for (const phone of numeros) {
    if (deja.includes(phone)) continue
    db.insert(users).values({ id: randomUUID(), phone, kycLevel: 0 }).run()
    crees.push(phone)
  }

  return { crees, existants: deja }
}
