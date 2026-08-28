import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import { and, desc, eq, gt, isNull } from 'drizzle-orm'
import type { useDb } from '../db/index.ts'
import { otpRequests, users } from '../db/schema.ts'
import { apiError } from '../utils/errors.ts'
import { isDevOrTest } from '../utils/env.ts'

type Db = ReturnType<typeof useDb>

/** Durée de validité d'un code. Court : un code qui traîne est un code volé. */
const VALIDITE_MS = 5 * 60 * 1000

/** Délai avant de pouvoir redemander un code. */
export const RENVOI_SECONDES = 30

/** Fenêtre et quota de limitation : 3 demandes par 10 minutes et par numéro. */
const FENETRE_LIMITE_MS = 10 * 60 * 1000
const MAX_DEMANDES = 3

/** Nombre d'échecs de saisie au-delà duquel on propose l'appel vocal. */
export const ECHECS_AVANT_VOCAL = 2

/** Essais de saisie autorisés sur un même code. */
const MAX_ESSAIS = 5

/**
 * Empreinte du code.
 *
 * HMAC et non simple SHA-256 : un code à six chiffres n'a qu'un million de
 * valeurs possibles, une table arc-en-ciel se calcule en quelques secondes.
 * La clé du serveur rend l'empreinte inexploitable même si la base fuite.
 */
function empreinte(phone: string, code: string): string {
  const secret = process.env.NUXT_SESSION_SECRET || 'secret-de-developpement-non-secret'
  return createHmac('sha256', secret).update(`${phone}:${code}`).digest('hex')
}

function comparaisonConstante(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  // Longueurs différentes : on compare quand même quelque chose, pour ne pas
  // révéler la longueur par le temps de réponse.
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

export interface OtpRequestResult {
  /** Toujours `true`. Voir la note sur l'énumération de comptes ci-dessous. */
  ok: true
  resendAfterSeconds: number
  /**
   * Le code, **uniquement en développement**. En production ce champ est absent :
   * le code part par SMS et ne transite jamais par la réponse HTTP.
   */
  devCode?: string
}

/**
 * Demande un code.
 *
 * **La réponse est identique que le numéro existe ou non** (acceptation T07).
 * Une réponse différente transformerait ce point d'entrée en annuaire : on
 * saurait qui est inscrit rien qu'en essayant des numéros. La création du
 * compte n'a lieu qu'à la vérification.
 *
 * La limitation de débit renvoie tout de même `429` : ce n'est pas une fuite,
 * elle porte sur le numéro appelé, pas sur son existence.
 */
export async function requestOtp(
  db: Db,
  phone: string,
  canal: 'sms' | 'voice' = 'sms',
): Promise<OtpRequestResult> {
  const depuis = new Date(Date.now() - FENETRE_LIMITE_MS)

  const recentes = db
    .select({ id: otpRequests.id, createdAt: otpRequests.createdAt })
    .from(otpRequests)
    .where(and(eq(otpRequests.phone, phone), gt(otpRequests.createdAt, depuis)))
    .orderBy(desc(otpRequests.createdAt))
    .all()

  if (recentes.length >= MAX_DEMANDES) {
    throw apiError(
      'RATE_LIMITED',
      'Trop de demandes de code. Patiente quelques minutes avant de réessayer.',
    )
  }

  const derniere = recentes[0]
  if (derniere && Date.now() - derniere.createdAt.getTime() < RENVOI_SECONDES * 1000) {
    throw apiError(
      'RATE_LIMITED',
      `Un code vient d’être envoyé. Attends ${RENVOI_SECONDES} secondes avant d’en demander un autre.`,
    )
  }

  // `randomInt` et non `Math.random` : un code de sécurité se tire avec un
  // générateur cryptographique, sinon il est prédictible.
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')

  // `createdAt` est posé explicitement, et non laissé au `unixepoch()` de
  // SQLite : la limitation de débit compare cette valeur à l'horloge du
  // processus. Deux horloges différentes, et la fenêtre de dix minutes devient
  // fausse — en test comme en production si la base tourne sur une autre machine.
  const maintenant = new Date()

  db.insert(otpRequests).values({
    id: randomUUID(),
    phone,
    codeHash: empreinte(phone, code),
    channel: canal,
    createdAt: maintenant,
    expiresAt: new Date(maintenant.getTime() + VALIDITE_MS),
  }).run()

  await livrerCode(phone, code, canal)

  return {
    ok: true,
    resendAfterSeconds: RENVOI_SECONDES,
    ...(isDevOrTest() ? { devCode: code } : {}),
  }
}

/**
 * Envoi du code.
 *
 * Aucun opérateur SMS n'est branché à ce stade : le code est écrit dans les
 * journaux du serveur. Le point d'entrée unique est ici, pour que le
 * branchement d'un fournisseur ne touche qu'une fonction.
 */
async function livrerCode(phone: string, code: string, canal: 'sms' | 'voice'): Promise<void> {
  if (isDevOrTest()) {
    console.info(`[otp] ${canal} vers ${phone} : ${code}`)
    return
  }
  // TODO(T-hors-périmètre) : brancher l'opérateur SMS / vocal.
  console.info(`[otp] ${canal} vers ${phone} : envoi non configuré`)
}

export interface OtpVerifyResult {
  userId: string
  isNewUser: boolean
}

/**
 * Vérifie un code et crée le compte s'il n'existe pas encore.
 *
 * Le compte naît **ici**, pas à la demande de code : sinon un inconnu peuplerait
 * la base de comptes fantômes en saisissant des numéros au hasard.
 */
export async function verifyOtp(db: Db, phone: string, code: string): Promise<OtpVerifyResult> {
  const [demande] = db
    .select()
    .from(otpRequests)
    .where(and(
      eq(otpRequests.phone, phone),
      isNull(otpRequests.consumedAt),
      gt(otpRequests.expiresAt, new Date()),
    ))
    .orderBy(desc(otpRequests.createdAt))
    .limit(1)
    .all()

  if (!demande) {
    throw apiError('VALIDATION_ERROR', 'Code expiré ou déjà utilisé. Demande un nouveau code.', { field: 'code' })
  }

  if (demande.attempts >= MAX_ESSAIS) {
    throw apiError('RATE_LIMITED', 'Trop d’essais sur ce code. Demande un nouveau code.')
  }

  if (!comparaisonConstante(demande.codeHash, empreinte(phone, code))) {
    db.update(otpRequests)
      .set({ attempts: demande.attempts + 1 })
      .where(eq(otpRequests.id, demande.id))
      .run()

    throw apiError('VALIDATION_ERROR', 'Code incorrect.', { field: 'code' })
  }

  db.update(otpRequests)
    .set({ consumedAt: new Date() })
    .where(eq(otpRequests.id, demande.id))
    .run()

  const [existant] = db.select().from(users).where(eq(users.phone, phone)).limit(1).all()
  if (existant) return { userId: existant.id, isNewUser: false }

  const userId = randomUUID()
  db.insert(users).values({ id: userId, phone, kycLevel: 0 }).run()
  return { userId, isNewUser: true }
}

/** Nombre d'échecs sur la dernière demande en cours — pilote l'offre d'appel vocal. */
export function failedAttempts(db: Db, phone: string): number {
  const [demande] = db
    .select({ attempts: otpRequests.attempts })
    .from(otpRequests)
    .where(eq(otpRequests.phone, phone))
    .orderBy(desc(otpRequests.createdAt))
    .limit(1)
    .all()

  return demande?.attempts ?? 0
}
