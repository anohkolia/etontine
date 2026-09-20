import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { codeAcces, emailAdresse, loginInput, registerInput } from '#shared/schemas'
import {
  BLOCAGE_BASE_MS, CONFIRMATION_VALIDITE_MS, ECHECS_AVANT_BLOCAGE, ECHECS_AVANT_VERROUILLAGE,
  REINITIALISATION_VALIDITE_MS, confirmerEmail, connecter, demanderChangementEmail, demanderReinitialisation,
  inscrire, limiterParIp, reinitialiserCode, reinitialiserLimitesIp, verifierCodeAcces,
} from '../../server/services/connexion.ts'
import { utiliserFournisseurEmail } from '../../server/services/email.ts'
import type { Email } from '../../server/services/email.ts'
import { emailTokens, users } from '../../server/db/schema.ts'
import type { User } from '../../server/db/schema.ts'
import { hashPin, verifyPin } from '../../server/utils/pin.ts'
import { createTestDb, createTestUser } from '../helpers/db.ts'
import type { TestDb } from '../helpers/db.ts'

/**
 * Inscription par e-mail, connexion par numéro et code, verrouillage.
 *
 * Zéro tolérance ici : ce sont les transitions d'état du compte, et c'est le
 * seul secret de toute l'application.
 */

let db: TestDb
let cleanup: () => Promise<void>

const NUMERO = '+2250707123456'
const EMAIL = 'aya@exemple.ci'
const CODE = '2604'
const T0 = new Date('2026-03-01T10:00:00Z')

/** Les e-mails partis pendant le test, dans l'ordre. */
let envoyes: Email[] = []

beforeEach(async () => {
  const ctx = await createTestDb()
  db = ctx.db
  cleanup = ctx.cleanup
  envoyes = []
  utiliserFournisseurEmail({
    nom: 'test',
    async envoyer(e) {
      envoyes.push(e)
    },
  })
  reinitialiserLimitesIp()
  vi.stubEnv('NODE_ENV', 'test')
})

afterEach(async () => {
  await cleanup()
  utiliserFournisseurEmail(null)
  vi.unstubAllEnvs()
})

function erreur(statut: number, motif?: RegExp) {
  return expect.objectContaining({
    statusCode: statut,
    ...(motif
      ? { data: { error: expect.objectContaining({ message: expect.stringMatching(motif) }) } }
      : {}),
  })
}

async function compte(phone = NUMERO): Promise<User> {
  return (await db.select().from(users).where(eq(users.phone, phone)))[0]!
}

/** Un compte inscrit et confirmé, prêt à se connecter. */
async function inscritEtConfirme(phone = NUMERO, email = EMAIL, code = CODE): Promise<User> {
  const { devToken } = await inscrire(db, { phone, email, code }, T0)
  await confirmerEmail(db, devToken!, T0)
  return await compte(phone)
}

describe('schémas', () => {
  it('refuse les codes évidents, exige quatre chiffres', () => {
    for (const c of ['0000', '1234', '4321', '1111', '2580']) expect(codeAcces.safeParse(c).success).toBe(false)
    for (const c of ['123', '12345', '12a4', ' 2604']) expect(codeAcces.safeParse(c).success).toBe(false)
    expect(codeAcces.parse('2604')).toBe('2604')
  })

  it('normalise l’adresse en minuscules', () => {
    expect(emailAdresse.parse('  Aya@Exemple.CI ')).toBe('aya@exemple.ci')
    expect(emailAdresse.safeParse('pas-une-adresse').success).toBe(false)
  })

  it('la connexion accepte un code de forme valide même s’il est dans la liste interdite', () => {
    // Refuser « 1234 » avant de vérifier révèlerait la règle sans rien
    // protéger : un ancien code peut être dans la liste.
    expect(loginInput.safeParse({ phone: '0707123456', code: '1234' }).success).toBe(true)
    expect(registerInput.safeParse({ phone: '0707123456', email: EMAIL, code: '1234' }).success).toBe(false)
  })
})

describe('inscription et confirmation — transitions du compte', () => {
  it('crée un compte non confirmé et envoie le lien', async () => {
    const resultat = await inscrire(db, { phone: NUMERO, email: EMAIL, code: CODE }, T0)

    expect(resultat.ok).toBe(true)
    expect(resultat.devToken).toMatch(/^[A-Za-z0-9_-]{43}$/)

    const u = await compte()
    expect(u.email).toBe(EMAIL)
    expect(u.emailVerifiedAt).toBeNull()
    expect(verifyPin(CODE, u.pinHash!)).toBe(true)

    expect(envoyes).toHaveLength(1)
    expect(envoyes[0]!.to).toBe(EMAIL)
    expect(envoyes[0]!.text).toContain(resultat.devToken)
  })

  it('ne stocke que l’empreinte du jeton', async () => {
    const { devToken } = await inscrire(db, { phone: NUMERO, email: EMAIL, code: CODE }, T0)
    const [jeton] = await db.select().from(emailTokens)
    expect(jeton!.tokenHash).not.toBe(devToken)
    expect(jeton!.tokenHash).toHaveLength(64)
    expect(jeton!.purpose).toBe('confirm_email')
    expect(jeton!.expiresAt.getTime()).toBe(T0.getTime() + CONFIRMATION_VALIDITE_MS)
  })

  it('le lien confirme le compte, ouvre la voie à la connexion, et ne sert qu’une fois', async () => {
    const { devToken } = await inscrire(db, { phone: NUMERO, email: EMAIL, code: CODE }, T0)

    await expect(connecter(db, NUMERO, CODE, T0)).rejects.toThrow(erreur(401))

    const { userId, isNewUser } = await confirmerEmail(db, devToken!, T0)
    expect(userId).toBe((await compte()).id)
    expect(isNewUser).toBe(true)
    expect((await compte()).emailVerifiedAt).toEqual(T0)

    await expect(connecter(db, NUMERO, CODE, T0)).resolves.toEqual({ userId })
    await expect(confirmerEmail(db, devToken!, T0)).rejects.toThrow(erreur(422, /expiré ou a déjà servi/))
  })

  it('refuse un lien expiré ou inconnu', async () => {
    const { devToken } = await inscrire(db, { phone: NUMERO, email: EMAIL, code: CODE }, T0)
    const plusTard = new Date(T0.getTime() + CONFIRMATION_VALIDITE_MS + 1)
    await expect(confirmerEmail(db, devToken!, plusTard)).rejects.toThrow(erreur(422))
    await expect(confirmerEmail(db, 'A'.repeat(43), T0)).rejects.toThrow(erreur(422))
  })

  it('répond pareil, et n’écrit à personne d’inconnu, quand le numéro est déjà confirmé', async () => {
    await inscritEtConfirme()
    envoyes = []

    // Avec une autre adresse : rien ne part — écrire à l'inconnu révélerait
    // qu'un compte existe sur ce numéro.
    const r1 = await inscrire(db, { phone: NUMERO, email: 'intrus@exemple.ci', code: '9182' }, T0)
    expect(r1).toEqual({ ok: true })
    expect(envoyes).toHaveLength(0)

    // Le compte n'a pas bougé : ni l'adresse, ni le code.
    const u = await compte()
    expect(u.email).toBe(EMAIL)
    expect(verifyPin(CODE, u.pinHash!)).toBe(true)

    // Avec sa propre adresse : on lui rappelle qu'il a déjà un compte.
    const r2 = await inscrire(db, { phone: NUMERO, email: EMAIL, code: '9182' }, T0)
    expect(r2).toEqual({ ok: true })
    expect(envoyes.map(e => e.to)).toEqual([EMAIL])
    expect(envoyes[0]!.subject).toMatch(/déjà un compte/)
  })

  it('reprend un compte jamais confirmé : nouvel e-mail, nouveau code, nouveau lien', async () => {
    // Quelqu'un s'inscrit avec le numéro d'un autre et ne confirme jamais : le
    // vrai titulaire ne doit pas être bloqué. Et c'est la voie par laquelle un
    // compte d'avant l'e-mail prend le sien.
    await inscrire(db, { phone: NUMERO, email: 'squatteur@exemple.ci', code: '9182' }, T0)
    const { devToken } = await inscrire(db, { phone: NUMERO, email: EMAIL, code: CODE }, T0)

    await confirmerEmail(db, devToken!, T0)
    const u = await compte()
    expect(u.email).toBe(EMAIL)
    expect(verifyPin(CODE, u.pinHash!)).toBe(true)
    expect(await db.select().from(users)).toHaveLength(1)
  })

  it('un compte créé avant l’e-mail (db:admin, SMS) prend son e-mail et son code par l’inscription', async () => {
    const ID = 'a0000000-0000-4000-8000-000000000001'
    await createTestUser(db, ID, NUMERO)
    const { devToken } = await inscrire(db, { phone: NUMERO, email: EMAIL, code: CODE }, T0)
    const { userId, isNewUser } = await confirmerEmail(db, devToken!, T0)
    expect(userId).toBe(ID)
    expect(isNewUser).toBe(true)
  })

  it('une adresse déjà confirmée ailleurs ne se prend pas, et l’adresse est prévenue', async () => {
    await inscritEtConfirme('+2250707000001', EMAIL)
    envoyes = []

    const r = await inscrire(db, { phone: NUMERO, email: EMAIL, code: CODE }, T0)
    expect(r).toEqual({ ok: true })
    expect(await db.select().from(users).where(eq(users.phone, NUMERO))).toHaveLength(0)
    expect(envoyes.map(e => e.subject)).toEqual([expect.stringMatching(/déjà un compte/)])
  })

  it('une adresse posée sans jamais être confirmée se libère pour qui la confirme', async () => {
    await inscrire(db, { phone: '+2250707000001', email: EMAIL, code: '9182' }, T0)
    const { devToken } = await inscrire(db, { phone: NUMERO, email: EMAIL, code: CODE }, T0)
    await confirmerEmail(db, devToken!, T0)

    expect((await compte()).email).toBe(EMAIL)
    expect((await compte('+2250707000001')).email).toBeNull()
  })

  it('limite les envois à trois par dix minutes et par compte', async () => {
    await inscrire(db, { phone: NUMERO, email: EMAIL, code: CODE }, T0)
    await inscrire(db, { phone: NUMERO, email: EMAIL, code: CODE }, T0)
    await inscrire(db, { phone: NUMERO, email: EMAIL, code: CODE }, T0)
    await expect(inscrire(db, { phone: NUMERO, email: EMAIL, code: CODE }, T0)).rejects.toThrow(erreur(429))

    // La fenêtre passée, on repart.
    const plusTard = new Date(T0.getTime() + 10 * 60 * 1000 + 1)
    await expect(inscrire(db, { phone: NUMERO, email: EMAIL, code: CODE }, plusTard)).resolves.toMatchObject({ ok: true })
  })

  it('n’expose pas le jeton en production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const r = await inscrire(db, { phone: NUMERO, email: EMAIL, code: CODE }, T0)
    expect(r).toEqual({ ok: true })
  })
})

describe('connexion — acceptation T07 : même réponse, numéro connu ou non', () => {
  it('refuse pareil un numéro inconnu, un compte non confirmé et un mauvais code', async () => {
    await expect(connecter(db, NUMERO, CODE, T0)).rejects.toThrow(erreur(401, /Numéro ou code incorrect/))

    const { devToken } = await inscrire(db, { phone: NUMERO, email: EMAIL, code: CODE }, T0)
    await expect(connecter(db, NUMERO, CODE, T0)).rejects.toThrow(erreur(401, /Numéro ou code incorrect/))

    await confirmerEmail(db, devToken!, T0)
    await expect(connecter(db, NUMERO, '9999', T0)).rejects.toThrow(erreur(401, /Numéro ou code incorrect/))
  })

  it('ouvre avec le bon code et remet les compteurs à zéro', async () => {
    const u = await inscritEtConfirme()
    await expect(connecter(db, NUMERO, '9999', T0)).rejects.toThrow(erreur(401))
    expect((await compte()).failedLogins).toBe(1)

    await expect(connecter(db, NUMERO, CODE, T0)).resolves.toEqual({ userId: u.id })
    expect((await compte()).failedLogins).toBe(0)
  })
})

describe('verrouillage — le compteur est en base', () => {
  it('bloque quinze minutes au cinquième échec, même pour le bon code, puis double', async () => {
    await inscritEtConfirme()
    for (let i = 0; i < ECHECS_AVANT_BLOCAGE - 1; i++) {
      await expect(connecter(db, NUMERO, '9999', T0)).rejects.toThrow(erreur(401))
    }
    await expect(connecter(db, NUMERO, '9999', T0)).rejects.toThrow(erreur(429, /15 minutes/))

    // Le bon code ne passe pas pendant le blocage : sinon il suffirait de
    // l'essayer entre deux mauvais.
    const pendant = new Date(T0.getTime() + 60_000)
    await expect(connecter(db, NUMERO, CODE, pendant)).rejects.toThrow(erreur(429, /minute/))

    // Le blocage tient en base : ce qu'un redémarrage du serveur effacerait
    // d'un compteur en mémoire est toujours là.
    expect((await compte()).lockedUntil!.getTime()).toBe(T0.getTime() + BLOCAGE_BASE_MS)

    // Après le délai, un nouvel échec bloque le double.
    const apres = new Date(T0.getTime() + BLOCAGE_BASE_MS + 1)
    await expect(connecter(db, NUMERO, '9999', apres)).rejects.toThrow(erreur(429, /30 minutes/))

    // Et le bon code rouvre, une fois ce second délai passé.
    const bienApres = new Date(apres.getTime() + 2 * BLOCAGE_BASE_MS + 1)
    await expect(connecter(db, NUMERO, CODE, bienApres)).resolves.toMatchObject({ userId: expect.any(String) })
    expect((await compte()).lockedUntil).toBeNull()
  })

  it('verrouille le compte au dixième échec, envoie un lien, et seul ce lien rouvre', async () => {
    await inscritEtConfirme()
    envoyes = []

    let t = T0.getTime()
    for (let i = 0; i < ECHECS_AVANT_VERROUILLAGE - 1; i++) {
      // On avance l'horloge au-delà de chaque blocage pour compter les échecs.
      await expect(connecter(db, NUMERO, '9999', new Date(t))).rejects.toThrow()
      const verrou = (await compte()).lockedUntil
      t = verrou ? verrou.getTime() + 1 : t + 1
    }
    await expect(connecter(db, NUMERO, '9999', new Date(t))).rejects.toThrow(erreur(403, /verrouillé/))

    // Le bon code ne suffit plus, à aucun moment.
    const loin = new Date(t + 365 * 24 * 3_600_000)
    await expect(connecter(db, NUMERO, CODE, loin)).rejects.toThrow(erreur(403, /verrouillé/))

    // Le lien est parti sur l'adresse du compte.
    const avis = envoyes.find(e => /verrouillé/.test(e.subject))
    expect(avis?.to).toBe(EMAIL)
    const token = avis!.text.match(/token=([A-Za-z0-9_-]+)/)![1]!

    await reinitialiserCode(db, token, '7391', new Date(t + 60_000))
    const u = await compte()
    expect(u.failedLogins).toBe(0)
    expect(u.lockedUntil).toBeNull()
    await expect(connecter(db, NUMERO, '7391', new Date(t + 60_000))).resolves.toMatchObject({ userId: u.id })
  })

  it('vérifie le code des gestes sensibles avec les mêmes compteurs', async () => {
    // L'écran de verrouillage, le changement de numéro, le canal de collecte :
    // deviner le code depuis un téléphone prêté coûte autant que depuis Internet.
    const u = await inscritEtConfirme()
    for (let i = 0; i < ECHECS_AVANT_BLOCAGE - 1; i++) {
      // 403 et non 401 : la session est valide, seul le code est faux — et le
      // client traite tout 401 hors authentification comme une session expirée.
      await expect(verifierCodeAcces(db, await compte(), '9999', T0)).rejects.toThrow(erreur(403, /Code incorrect/))
    }
    await expect(verifierCodeAcces(db, await compte(), '9999', T0)).rejects.toThrow(erreur(429))
    await expect(connecter(db, NUMERO, CODE, T0)).rejects.toThrow(erreur(429))
    await expect(verifierCodeAcces(db, u, CODE, new Date(T0.getTime() + BLOCAGE_BASE_MS + 1))).resolves.toBeUndefined()
  })

  it('limite les essais par adresse, tous comptes confondus', () => {
    // Levée hors production pour les tests de bout en bout ; ici on la force.
    vi.stubEnv('NUXT_LIMITE_IP', '1')
    for (let i = 0; i < 20; i++) limiterParIp('203.0.113.7', T0.getTime())
    expect(() => limiterParIp('203.0.113.7', T0.getTime())).toThrow(erreur(429))
    // Une autre adresse n'est pas concernée, et la fenêtre glisse.
    expect(() => limiterParIp('203.0.113.8', T0.getTime())).not.toThrow()
    expect(() => limiterParIp('203.0.113.7', T0.getTime() + 10 * 60 * 1000 + 1)).not.toThrow()
    expect(() => limiterParIp(undefined, T0.getTime())).not.toThrow()
  })
})

describe('code oublié', () => {
  it('envoie un lien sur l’adresse du compte, et répond pareil pour un inconnu', async () => {
    await inscritEtConfirme()
    envoyes = []

    expect(await demanderReinitialisation(db, '+2250707000099', T0)).toEqual({ ok: true })
    expect(envoyes).toHaveLength(0)

    const r = await demanderReinitialisation(db, NUMERO, T0)
    expect(r.ok).toBe(true)
    expect(envoyes.map(e => e.to)).toEqual([EMAIL])
    const [jeton] = await db.select().from(emailTokens).where(eq(emailTokens.purpose, 'reset_code'))
    expect(jeton!.expiresAt.getTime()).toBe(T0.getTime() + REINITIALISATION_VALIDITE_MS)
  })

  it('pose le nouveau code, et le lien ne sert qu’une fois', async () => {
    const u = await inscritEtConfirme()
    const { devToken } = await demanderReinitialisation(db, NUMERO, T0)

    await expect(reinitialiserCode(db, devToken!, '7391', T0)).resolves.toEqual({ userId: u.id })
    await expect(connecter(db, NUMERO, CODE, T0)).rejects.toThrow(erreur(401))
    await expect(connecter(db, NUMERO, '7391', T0)).resolves.toEqual({ userId: u.id })
    await expect(reinitialiserCode(db, devToken!, '5170', T0)).rejects.toThrow(erreur(422))
  })

  it('un lien de confirmation ne réinitialise pas le code, et inversement', async () => {
    const { devToken } = await inscrire(db, { phone: NUMERO, email: EMAIL, code: CODE }, T0)
    await expect(reinitialiserCode(db, devToken!, '7391', T0)).rejects.toThrow(erreur(422))
    await confirmerEmail(db, devToken!, T0)

    const reset = await demanderReinitialisation(db, NUMERO, T0)
    await expect(confirmerEmail(db, reset.devToken!, T0)).rejects.toThrow(erreur(422))
  })
})

describe('changement d’adresse', () => {
  it('exige le code, envoie sur la nouvelle adresse, et prévient l’ancienne à la confirmation', async () => {
    const u = await inscritEtConfirme()
    envoyes = []

    await expect(demanderChangementEmail(db, u, 'nouvelle@exemple.ci', '9999', T0)).rejects.toThrow(erreur(403))
    await expect(demanderChangementEmail(db, await compte(), EMAIL, CODE, T0)).rejects.toThrow(erreur(422, /déjà ton adresse/))

    const { devToken } = await demanderChangementEmail(db, await compte(), 'nouvelle@exemple.ci', CODE, T0)
    expect(envoyes.map(e => e.to)).toEqual(['nouvelle@exemple.ci'])
    // Rien n'a changé tant que le lien n'est pas cliqué.
    expect((await compte()).email).toBe(EMAIL)

    await confirmerEmail(db, devToken!, T0)
    expect((await compte()).email).toBe('nouvelle@exemple.ci')
    expect(envoyes.map(e => e.to)).toEqual(['nouvelle@exemple.ci', EMAIL])
    expect(envoyes[1]!.text).toContain('nouvelle@exemple.ci')
  })

  it('ne dit rien quand l’adresse appartient déjà à un autre compte confirmé', async () => {
    await inscritEtConfirme('+2250707000001', 'autre@exemple.ci', '9182')
    const u = await inscritEtConfirme()
    envoyes = []

    const r = await demanderChangementEmail(db, u, 'autre@exemple.ci', CODE, T0)
    expect(r).toEqual({ ok: true })
    expect(envoyes).toHaveLength(0)
  })
})

describe('empreinte du code', () => {
  it('ne stocke jamais le code, et sale chaque empreinte', () => {
    const empreinte = hashPin(CODE)
    expect(empreinte).not.toContain(CODE)
    expect(verifyPin(CODE, empreinte)).toBe(true)
    expect(hashPin(CODE)).not.toBe(hashPin(CODE))
  })
})
