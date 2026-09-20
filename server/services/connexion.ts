import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { and, eq, gt, isNull } from 'drizzle-orm'
import type { useDb } from '../db/index.ts'
import { emailTokens, users } from '../db/schema.ts'
import type { EmailToken, User } from '../db/schema.ts'
import { apiError } from '../utils/errors.ts'
import { isDevOrTest } from '../utils/env.ts'
import { hashPin, verifyPin } from '../utils/pin.ts'
import { envoyerEmail, messages } from './email.ts'

type Db = ReturnType<typeof useDb>

/**
 * Inscription, connexion et réinitialisation — sans SMS.
 *
 * Le numéro de téléphone identifie le compte, l'e-mail le **confirme**, et un
 * code à quatre chiffres l'ouvre. Ce code est le seul secret : il n'a que dix
 * mille valeurs, et le numéro qui va avec n'est pas secret — tous les membres
 * d'une tontine voient ceux des autres. Ce qui rend le modèle tenable :
 *
 * - le compteur d'échecs est **en base**, pas en mémoire : un redémarrage du
 *   serveur ne remet pas le chronomètre à zéro ;
 * - le blocage est progressif à partir de cinq échecs, puis le compte se
 *   **verrouille** au dixième, et seul un lien reçu par e-mail le rouvre ;
 * - une adresse IP n'a droit qu'à un nombre borné d'essais, tous comptes
 *   confondus, pour couper l'attaque « 1234 sur tous les numéros » ;
 * - la réponse est la même que le numéro existe ou non (acceptation T07) : ce
 *   point d'entrée ne doit pas servir d'annuaire.
 *
 * Le même code protège l'écran de verrouillage et les gestes sensibles
 * (changer de numéro, ajouter un numéro de collecte) : `verifierCodeAcces`
 * partage les compteurs de la connexion. Quelqu'un qui devine le code depuis
 * un téléphone prêté se heurte au même verrou que depuis Internet.
 */

/** Validité d'un lien de confirmation d'adresse, et d'un lien de réinitialisation. */
export const CONFIRMATION_VALIDITE_MS = 24 * 60 * 60 * 1000
export const REINITIALISATION_VALIDITE_MS = 60 * 60 * 1000

/** Envois d'e-mails par compte : 3 par 10 minutes. */
const FENETRE_ENVOIS_MS = 10 * 60 * 1000
const MAX_ENVOIS = 3

/** Échecs avant blocage temporaire, et avant verrouillage du compte. */
export const ECHECS_AVANT_BLOCAGE = 5
export const ECHECS_AVANT_VERROUILLAGE = 10
/** Premier blocage : 15 min, puis le double à chaque échec (30, 60, 120…). */
export const BLOCAGE_BASE_MS = 15 * 60 * 1000

/** Essais par adresse IP, tous comptes confondus : 20 par 10 minutes. */
const FENETRE_IP_MS = 10 * 60 * 1000
const MAX_PAR_IP = 20

/**
 * Empreinte factice, calculée une fois : quand le numéro est inconnu, on
 * vérifie quand même un code contre elle. Sans cela, l'absence de calcul
 * scrypt rendrait la réponse plus rapide, et le temps de réponse dirait qui
 * est inscrit.
 */
const EMPREINTE_FACTICE = hashPin('0000')

const MESSAGE_IDENTIFIANTS = 'Numéro ou code incorrect.'
const MESSAGE_CODE = 'Code incorrect.'
const MESSAGE_VERROUILLE = 'Compte verrouillé après trop d’essais. Un lien pour choisir un nouveau code t’a été envoyé par e-mail.'

/* ------------------------------------------------------------------ *
 * Limitation par adresse IP
 * ------------------------------------------------------------------ */

/**
 * En mémoire, et c'est assumé : cette limite est un filet **en plus** des
 * compteurs par compte, qui eux sont en base. La perdre au redémarrage ne
 * rouvre rien, et une table pour vingt essais serait de la cérémonie.
 *
 * Hors production, elle est levée — sauf `NUXT_LIMITE_IP=1` : les tests de
 * bout en bout ouvrent des dizaines de sessions depuis la même adresse, et
 * les compteurs par compte, eux, restent actifs partout.
 */
const essaisParIp = new Map<string, number[]>()

/** Pour les tests : oublie toutes les adresses. */
export function reinitialiserLimitesIp(): void {
  essaisParIp.clear()
}

export function limiterParIp(ip: string | undefined, maintenant = Date.now()): void {
  if (!ip) return
  if (isDevOrTest() && process.env.NUXT_LIMITE_IP !== '1') return
  const recents = (essaisParIp.get(ip) ?? []).filter(t => maintenant - t < FENETRE_IP_MS)
  if (recents.length >= MAX_PAR_IP) {
    throw apiError('RATE_LIMITED', 'Trop d’essais depuis cet appareil. Patiente quelques minutes.')
  }
  recents.push(maintenant)
  essaisParIp.set(ip, recents)
}

/* ------------------------------------------------------------------ *
 * Jetons envoyés par e-mail
 * ------------------------------------------------------------------ */

function empreinteJeton(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export interface ResultatDemande {
  /** Toujours `true` : la réponse ne dit pas si le compte existe. */
  ok: true
  /**
   * Le jeton du lien, **uniquement en développement et en test**. En
   * production ce champ est absent : le lien part par e-mail et ne transite
   * jamais par la réponse HTTP.
   */
  devToken?: string
}

/**
 * Crée un jeton, l'envoie, et rend le résultat à répondre.
 *
 * La limitation porte sur le **compte** : trois envois par dix minutes, tous
 * motifs confondus. C'est ce qui empêche de faire de ce serveur une machine à
 * arroser une boîte mail.
 */
async function emettreJeton(
  db: Db,
  userId: string,
  purpose: EmailToken['purpose'],
  email: string,
  validiteMs: number,
  message: (token: string) => Omit<Parameters<typeof envoyerEmail>[0], 'to'>,
  maintenant = new Date(),
): Promise<ResultatDemande> {
  const depuis = new Date(maintenant.getTime() - FENETRE_ENVOIS_MS)
  const recents = await db
    .select({ id: emailTokens.id })
    .from(emailTokens)
    .where(and(eq(emailTokens.userId, userId), gt(emailTokens.createdAt, depuis)))

  if (recents.length >= MAX_ENVOIS) {
    throw apiError('RATE_LIMITED', 'Trop de demandes. Patiente quelques minutes avant de réessayer.')
  }

  // `randomBytes` et non un UUID : un jeton qui ouvre un compte se tire avec
  // 256 bits d'aléa cryptographique, pas avec un identifiant.
  const token = randomBytes(32).toString('base64url')

  await db.insert(emailTokens).values({
    id: randomUUID(),
    userId,
    purpose,
    tokenHash: empreinteJeton(token),
    email,
    createdAt: maintenant,
    expiresAt: new Date(maintenant.getTime() + validiteMs),
  })

  await envoyerEmail({ to: email, ...message(token) })

  return { ok: true, ...(isDevOrTest() ? { devToken: token } : {}) }
}

/** Le jeton s'il est valide — existant, non consommé, non expiré — sinon l'erreur à afficher. */
async function jetonValide(db: Db, token: string, purposes: EmailToken['purpose'][], maintenant = new Date()): Promise<EmailToken> {
  const [jeton] = await db
    .select()
    .from(emailTokens)
    .where(and(
      eq(emailTokens.tokenHash, empreinteJeton(token)),
      isNull(emailTokens.consumedAt),
      gt(emailTokens.expiresAt, maintenant),
    ))
    .limit(1)

  if (!jeton || !purposes.includes(jeton.purpose)) {
    throw apiError('VALIDATION_ERROR', 'Ce lien est expiré ou a déjà servi. Demande-en un nouveau.', { field: 'token' })
  }
  return jeton
}

/* ------------------------------------------------------------------ *
 * Inscription et confirmation
 * ------------------------------------------------------------------ */

/**
 * Inscription : crée le compte, non confirmé, et envoie le lien.
 *
 * **La réponse est identique dans tous les cas.** Ce qui se passe derrière :
 *
 * - numéro libre, e-mail libre : le compte est créé, le lien part ;
 * - numéro déjà pris par un compte **jamais confirmé** : ce compte est repris
 *   — nouvel e-mail, nouveau code, nouveau lien. C'est ce qui empêche
 *   quelqu'un de bloquer un numéro en s'inscrivant à sa place sans jamais
 *   confirmer, et c'est aussi la voie par laquelle un compte créé avant
 *   l'e-mail (par SMS, ou par `pnpm db:admin`) prend son e-mail et son code ;
 * - numéro déjà pris par un compte confirmé : rien n'est créé. Si l'e-mail
 *   donné est celui du compte, on lui rappelle qu'il en a déjà un ; sinon, on
 *   ne dit rien à personne — écrire à l'adresse inconnue révélerait qu'un
 *   compte existe sur ce numéro ;
 * - e-mail déjà pris par un autre compte confirmé : rien n'est créé, et
 *   l'adresse reçoit un rappel qu'elle a déjà un compte.
 */
export async function inscrire(
  db: Db,
  input: { phone: string, email: string, code: string },
  maintenant = new Date(),
): Promise<ResultatDemande> {
  const [parNumero] = await db.select().from(users).where(eq(users.phone, input.phone)).limit(1)

  if (parNumero?.emailVerifiedAt) {
    if (parNumero.email === input.email) await envoyerEmail({ to: input.email, ...messages.dejaInscrit() })
    return { ok: true }
  }

  const [parEmail] = await db.select().from(users).where(eq(users.email, input.email)).limit(1)
  if (parEmail && parEmail.id !== parNumero?.id) {
    if (parEmail.emailVerifiedAt) {
      await envoyerEmail({ to: input.email, ...messages.dejaInscrit() })
      return { ok: true }
    }
    // Une adresse posée par une inscription jamais confirmée n'a jamais été
    // prouvée : elle se libère pour celui qui la confirme.
    await db.update(users).set({ email: null }).where(eq(users.id, parEmail.id))
  }

  let userId: string
  if (parNumero) {
    userId = parNumero.id
    await db.update(users)
      .set({ email: input.email, pinHash: hashPin(input.code), failedLogins: 0, lockedUntil: null })
      .where(eq(users.id, userId))
  }
  else {
    userId = randomUUID()
    await db.insert(users).values({
      id: userId,
      phone: input.phone,
      email: input.email,
      pinHash: hashPin(input.code),
      kycLevel: 0,
    })
  }

  return await emettreJeton(db, userId, 'confirm_email', input.email, CONFIRMATION_VALIDITE_MS, messages.confirmation, maintenant)
}

/**
 * Confirme une adresse — inscription ou changement — et rend le compte.
 *
 * C'est **ici** que le compte devient utilisable : jusqu'au clic, personne ne
 * peut se connecter avec ce numéro. Le lien ouvre la session dans la foulée :
 * il prouve la boîte mail, et le code vient d'être choisi.
 */
export async function confirmerEmail(db: Db, token: string, maintenant = new Date()): Promise<{ userId: string, isNewUser: boolean }> {
  const jeton = await jetonValide(db, token, ['confirm_email', 'change_email'], maintenant)

  const [compte] = await db.select().from(users).where(eq(users.id, jeton.userId)).limit(1)
  if (!compte) throw apiError('NOT_FOUND', 'Compte introuvable.')

  // L'adresse a pu être prise entre l'envoi et le clic. Par un compte
  // confirmé : on le dit proprement plutôt que de laisser remonter l'erreur
  // d'unicité. Par un compte jamais confirmé : elle n'a jamais été prouvée,
  // elle se libère.
  const [autre] = await db.select({ id: users.id, verifie: users.emailVerifiedAt }).from(users)
    .where(eq(users.email, jeton.email))
    .limit(1)
  if (autre && autre.id !== compte.id) {
    if (autre.verifie) {
      throw apiError('VALIDATION_ERROR', 'Cette adresse est déjà rattachée à un autre compte.', { field: 'email' })
    }
    await db.update(users).set({ email: null }).where(eq(users.id, autre.id))
  }

  const ancienneAdresse = compte.emailVerifiedAt ? compte.email : null

  await db.update(users)
    .set({ email: jeton.email, emailVerifiedAt: maintenant })
    .where(eq(users.id, compte.id))

  await db.update(emailTokens).set({ consumedAt: maintenant }).where(eq(emailTokens.id, jeton.id))

  if (jeton.purpose === 'change_email' && ancienneAdresse && ancienneAdresse !== jeton.email) {
    // L'ancienne adresse l'apprend : c'est là que quelqu'un qui a perdu la
    // main sur son compte le découvre.
    await envoyerEmail({ to: ancienneAdresse, ...messages.emailChange(jeton.email) })
  }

  return { userId: compte.id, isNewUser: jeton.purpose === 'confirm_email' && !compte.firstName }
}

/* ------------------------------------------------------------------ *
 * Connexion et vérification du code
 * ------------------------------------------------------------------ */

/** Le compte est-il verrouillé pour de bon (dixième échec) ? */
export function estVerrouille(user: Pick<User, 'failedLogins'>): boolean {
  return user.failedLogins >= ECHECS_AVANT_VERROUILLAGE
}

/**
 * Vérifie le code d'accès d'un compte, en tenant les compteurs.
 *
 * Réussite : les compteurs tombent. Échec : le compteur monte ; à partir de
 * cinq, un blocage qui double à chaque fois ; au dixième, le compte est
 * verrouillé et un lien de réinitialisation part par e-mail — c'est la seule
 * façon de le rouvrir. Le blocage s'applique **même au bon code** : sinon il
 * suffirait de l'essayer entre deux mauvais.
 *
 * Un mauvais code sur un geste sensible est un `403`, pas un `401` : la
 * session, elle, est valide, et le client traite tout `401` hors
 * authentification comme une session expirée.
 */
export async function verifierCodeAcces(
  db: Db,
  user: User,
  code: string,
  maintenant = new Date(),
  echec: () => Error = () => apiError('FORBIDDEN', MESSAGE_CODE, { field: 'code' }),
): Promise<void> {
  if (estVerrouille(user)) {
    throw apiError('FORBIDDEN', MESSAGE_VERROUILLE)
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > maintenant.getTime()) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - maintenant.getTime()) / 60_000)
    throw apiError('RATE_LIMITED', `Trop d’essais. Réessaie dans ${minutes} minute${minutes > 1 ? 's' : ''}.`)
  }

  if (user.pinHash && verifyPin(code, user.pinHash)) {
    if (user.failedLogins > 0 || user.lockedUntil) {
      await db.update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, user.id))
    }
    return
  }

  const echecs = user.failedLogins + 1

  if (echecs >= ECHECS_AVANT_VERROUILLAGE) {
    await db.update(users).set({ failedLogins: echecs, lockedUntil: null }).where(eq(users.id, user.id))
    if (user.email && user.emailVerifiedAt) {
      // L'envoi peut être refusé par la limitation : le compte est verrouillé
      // quand même, et « code oublié » saura renvoyer un lien plus tard.
      await emettreJeton(db, user.id, 'reset_code', user.email, REINITIALISATION_VALIDITE_MS, messages.compteVerrouille, maintenant)
        .catch(() => null)
    }
    throw apiError('FORBIDDEN', MESSAGE_VERROUILLE)
  }

  if (echecs >= ECHECS_AVANT_BLOCAGE) {
    const duree = BLOCAGE_BASE_MS * 2 ** (echecs - ECHECS_AVANT_BLOCAGE)
    await db.update(users)
      .set({ failedLogins: echecs, lockedUntil: new Date(maintenant.getTime() + duree) })
      .where(eq(users.id, user.id))
    const minutes = Math.round(duree / 60_000)
    throw apiError('RATE_LIMITED', `Trop d’essais. Réessaie dans ${minutes} minutes.`)
  }

  await db.update(users).set({ failedLogins: echecs }).where(eq(users.id, user.id))
  throw echec()
}

/**
 * Connexion par numéro et code.
 *
 * Un numéro inconnu, ou jamais confirmé, reçoit **le même refus** qu'un
 * mauvais code, après le même calcul : ni le message ni le temps de réponse
 * ne disent qui est inscrit.
 */
export async function connecter(db: Db, phone: string, code: string, maintenant = new Date()): Promise<{ userId: string }> {
  const [compte] = await db.select().from(users).where(eq(users.phone, phone)).limit(1)

  if (!compte || !compte.emailVerifiedAt || !compte.pinHash) {
    verifyPin(code, EMPREINTE_FACTICE)
    throw apiError('UNAUTHENTICATED', MESSAGE_IDENTIFIANTS, { field: 'code' })
  }

  await verifierCodeAcces(db, compte, code, maintenant, () => apiError('UNAUTHENTICATED', MESSAGE_IDENTIFIANTS, { field: 'code' }))
  return { userId: compte.id }
}

/* ------------------------------------------------------------------ *
 * Code oublié
 * ------------------------------------------------------------------ */

/**
 * Demande un lien de réinitialisation, par numéro.
 *
 * Le lien part sur l'adresse du compte — le demandeur ne la saisit pas, et ne
 * la voit pas. Un numéro inconnu ou non confirmé ne fait rien, et répond
 * pareil.
 */
export async function demanderReinitialisation(db: Db, phone: string, maintenant = new Date()): Promise<ResultatDemande> {
  const [compte] = await db.select().from(users).where(eq(users.phone, phone)).limit(1)
  if (!compte?.email || !compte.emailVerifiedAt) return { ok: true }

  return await emettreJeton(db, compte.id, 'reset_code', compte.email, REINITIALISATION_VALIDITE_MS, messages.reinitialisation, maintenant)
}

/** Pose un nouveau code par le lien reçu, et rouvre le compte s'il était verrouillé. */
export async function reinitialiserCode(db: Db, token: string, code: string, maintenant = new Date()): Promise<{ userId: string }> {
  const jeton = await jetonValide(db, token, ['reset_code'], maintenant)

  await db.update(users)
    .set({ pinHash: hashPin(code), failedLogins: 0, lockedUntil: null })
    .where(eq(users.id, jeton.userId))

  await db.update(emailTokens).set({ consumedAt: maintenant }).where(eq(emailTokens.id, jeton.id))

  return { userId: jeton.userId }
}

/* ------------------------------------------------------------------ *
 * Changement d'adresse
 * ------------------------------------------------------------------ */

/**
 * Demande à changer d'adresse : le code d'accès d'abord, puis un lien sur la
 * **nouvelle** adresse. L'ancienne sera prévenue à la confirmation.
 *
 * Une adresse déjà prise par un autre compte confirmé ne reçoit rien et la
 * réponse ne le dit pas : l'appelant est connecté, mais rien ne l'autorise à
 * savoir qui d'autre est inscrit.
 */
export async function demanderChangementEmail(
  db: Db,
  user: User,
  email: string,
  code: string,
  maintenant = new Date(),
): Promise<ResultatDemande> {
  await verifierCodeAcces(db, user, code, maintenant)

  if (user.email === email && user.emailVerifiedAt) {
    throw apiError('VALIDATION_ERROR', 'C’est déjà ton adresse.', { field: 'email' })
  }

  const [pris] = await db.select({ id: users.id, verifie: users.emailVerifiedAt }).from(users)
    .where(eq(users.email, email)).limit(1)
  if (pris && pris.id !== user.id && pris.verifie) return { ok: true }

  return await emettreJeton(db, user.id, 'change_email', email, CONFIRMATION_VALIDITE_MS, messages.changementEmail, maintenant)
}
