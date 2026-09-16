import { eq } from 'drizzle-orm'
import type { useDb } from '../db/index.ts'
import { sessions, users } from '../db/schema.ts'
import type { User } from '../db/schema.ts'
import { apiError } from '../utils/errors.ts'
import { verifyPin } from '../utils/pin.ts'

type Db = ReturnType<typeof useDb>

/** Essais autorisés avant blocage, et durée du blocage. */
export const ESSAIS_MAX = 5
export const BLOCAGE_MS = 15 * 60 * 1000

/**
 * Une connexion par code SMS de moins de dix minutes est « fraîche » : elle
 * prouve la possession de la carte SIM, ce qui vaut plus qu'un code d'écran.
 */
export const SESSION_FRAICHE_MS = 10 * 60 * 1000

interface Compteur {
  echecs: number
  bloqueJusqua: number | null
}

/**
 * Compteur d'échecs, en mémoire.
 *
 * Le code de verrouillage protège l'écran, pas le compte : la session tient au
 * cookie, et c'est elle qui vaut authentification. Un compteur perdu au
 * redémarrage du serveur ne coûte donc rien de grave, et une table pour cinq
 * essais serait de la cérémonie. Il empêche ce qui compte : essayer les dix
 * mille codes à quatre chiffres depuis un téléphone emprunté.
 */
const compteurs = new Map<string, Compteur>()

/** Pour les tests : oublie tous les compteurs. */
export function reinitialiserCompteurs(): void {
  compteurs.clear()
}

/**
 * Vérifie le code de verrouillage.
 *
 * Cinq échecs bloquent quinze minutes, et le message dit combien d'essais
 * restent : sans cela, quelqu'un qui hésite entre deux codes se bloque sans
 * l'avoir vu venir.
 */
export function verifierCodeVerrou(user: User, pin: string, maintenant = Date.now()): { ok: true } {
  if (!user.pinHash) {
    throw apiError('INVALID_TRANSITION', 'Aucun code de verrouillage n’est défini.', { field: 'pin' })
  }

  const compteur = compteurs.get(user.id) ?? { echecs: 0, bloqueJusqua: null }

  if (compteur.bloqueJusqua && compteur.bloqueJusqua > maintenant) {
    const minutes = Math.ceil((compteur.bloqueJusqua - maintenant) / 60_000)
    throw apiError('RATE_LIMITED', `Trop d’essais. Réessaie dans ${minutes} minute${minutes > 1 ? 's' : ''}, ou reconnecte-toi par SMS.`)
  }

  if (verifyPin(pin, user.pinHash)) {
    compteurs.delete(user.id)
    return { ok: true }
  }

  const echecs = (compteur.bloqueJusqua ? 0 : compteur.echecs) + 1
  if (echecs >= ESSAIS_MAX) {
    compteurs.set(user.id, { echecs, bloqueJusqua: maintenant + BLOCAGE_MS })
    throw apiError('RATE_LIMITED', 'Trop d’essais. Réessaie dans 15 minutes, ou reconnecte-toi par SMS.')
  }

  compteurs.set(user.id, { echecs, bloqueJusqua: null })
  const restants = ESSAIS_MAX - echecs
  throw apiError(
    'FORBIDDEN',
    `Code incorrect. Il te reste ${restants} essai${restants > 1 ? 's' : ''}.`,
    { field: 'pin' },
  )
}

/**
 * La session courante vient-elle d'être ouverte par SMS ?
 *
 * C'est la porte de sortie de « code oublié » : quelqu'un qui a perdu son code
 * ne peut pas le retirer — le retrait l'exige — et se retrouvait enfermé
 * dehors pour de bon. Se reconnecter par SMS prouve qu'on tient la SIM, et ce
 * temps-là, le retrait du code n'exige plus l'ancien.
 */
export async function sessionFraiche(db: Db, sessionId: string | undefined, maintenant = Date.now()): Promise<boolean> {
  if (!sessionId) return false
  const [s] = await db.select({ createdAt: sessions.createdAt }).from(sessions).where(eq(sessions.id, sessionId)).limit(1)
  return Boolean(s && maintenant - s.createdAt.getTime() < SESSION_FRAICHE_MS)
}

/** Retire le code de verrouillage. */
export async function retirerCodeVerrou(db: Db, userId: string): Promise<void> {
  await db.update(users).set({ pinHash: null }).where(eq(users.id, userId))
  compteurs.delete(userId)
}
