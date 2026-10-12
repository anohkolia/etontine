import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { registerInput } from '#shared/schemas'
import { confirmerEmail, inscrire, reinitialiserLimitesIp } from '../../server/services/connexion.ts'
import { utiliserFournisseurEmail } from '../../server/services/email.ts'
import type { Email } from '../../server/services/email.ts'
import {
  alerterAdministrateurs, nombreNouveauxOrganisateurs, organisateurs, prendreEnCompteOrganisateur,
  promouvoirOrganisateur,
} from '../../server/services/organisateurs.ts'
import { creerBrouillon } from '../../server/services/tontines.ts'
import { adminAudit, users } from '../../server/db/schema.ts'
import type { User } from '../../server/db/schema.ts'
import { createTestDb, createTestUser } from '../helpers/db.ts'
import type { TestDb } from '../helpers/db.ts'

/**
 * Les organisateurs : qui s'inscrit sans lien d'invitation vient organiser,
 * le back-office en est alerté, et un membre qui crée sa première tontine le
 * devient à son tour.
 */

let db: TestDb
let cleanup: () => Promise<void>

const ADMIN = { id: 'adad0000-0000-4000-8000-000000000001', phone: '+2250500000001' }
const ADMIN_EMAIL = 'admin@etontine.ci'
const T0 = new Date('2026-03-01T10:00:00Z')
const T1 = new Date('2026-03-01T11:00:00Z')
const CODE = '2604'
/** La forme d'un jeton de `creerInvitation` : 16 octets en base64url. */
const INVITATION = 'Zx9_kQ2-mN4pL7wR1tY6vA'

let envoyes: Email[] = []

/** Les alertes parties vers les administrateurs, et elles seules. */
function alertes(): Email[] {
  return envoyes.filter(e => e.subject === 'Nouvel organisateur sur eTontine')
}

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
  vi.stubEnv('NUXT_ADMIN_PHONES', ADMIN.phone)
  vi.stubEnv('NUXT_ADMIN_SITE_URL', 'https://admin.tontine.ci/')

  // L'administrateur s'est inscrit comme tout le monde : son adresse est confirmée.
  await db.insert(users).values({ id: ADMIN.id, phone: ADMIN.phone, email: ADMIN_EMAIL, emailVerifiedAt: T0 })
})

afterEach(async () => {
  await cleanup()
  utiliserFournisseurEmail(null)
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

async function compte(phone: string): Promise<User> {
  return (await db.select().from(users).where(eq(users.phone, phone)))[0]!
}

/** Inscrit puis confirme un compte — par un lien d'invitation si l'on en donne un. */
async function inscritEtConfirme(phone: string, options: { invitation?: string, quand?: Date } = {}): Promise<User> {
  const email = `${phone.slice(-8)}@exemple.ci`
  const { devToken } = await inscrire(db, { phone, email, code: CODE, invitation: options.invitation }, options.quand ?? T0)
  await confirmerEmail(db, devToken!, options.quand ?? T0)
  return await compte(phone)
}

describe('inscription — organisateur ou membre', () => {
  it('sans lien d’invitation, le compte organise, et les administrateurs sont alertés à la confirmation', async () => {
    const { devToken } = await inscrire(db, { phone: '+2250707123456', email: 'aya@exemple.ci', code: CODE }, T0)

    // Marqué dès l'inscription, mais personne n'est encore alerté : tant que
    // l'adresse n'est pas confirmée, le compte n'existe pas vraiment.
    expect((await compte('+2250707123456')).organizerSince).toEqual(T0)
    expect(alertes()).toHaveLength(0)

    await confirmerEmail(db, devToken!, T0)

    expect(alertes()).toHaveLength(1)
    const [alerte] = alertes()
    expect(alerte!.to).toBe(ADMIN_EMAIL)
    expect(alerte!.text).toContain('se terminant par 3456')
    expect(alerte!.text).toMatch(/^https:\/\/admin\.tontine\.ci\/organisateurs$/m)
    // Une boîte mail se partage : ni le numéro entier, ni l'adresse du compte.
    expect(alerte!.text).not.toContain('+2250707123456')
    expect(alerte!.text).not.toContain('aya@exemple.ci')
  })

  it('par un lien d’invitation, le compte est celui d’un membre : pas d’alerte, et la confirmation ramène sur l’invitation', async () => {
    const { devToken } = await inscrire(
      db, { phone: '+2250707123456', email: 'aya@exemple.ci', code: CODE, invitation: INVITATION }, T0,
    )

    expect((await compte('+2250707123456')).organizerSince).toBeNull()

    // Le lien parti par e-mail porte le retour vers l'invitation : sans lui,
    // le membre atterrissait sur son profil, sans la tontine qu'il rejoignait.
    const [confirmation] = envoyes
    expect(confirmation!.text).toMatch(new RegExp(`/confirmer\\?token=${devToken}&redirect=%2Fjoin%2F${INVITATION}$`, 'm'))

    await confirmerEmail(db, devToken!, T0)
    expect(alertes()).toHaveLength(0)
  })

  it('n’alerte qu’une fois, même quand deux liens de confirmation sont ouverts', async () => {
    const premier = await inscrire(db, { phone: '+2250707123456', email: 'aya@exemple.ci', code: CODE }, T0)
    const second = await inscrire(db, { phone: '+2250707123456', email: 'aya@exemple.ci', code: CODE }, T0)

    await confirmerEmail(db, premier.devToken!, T0)
    await confirmerEmail(db, second.devToken!, T0)

    expect(alertes()).toHaveLength(1)
  })

  it('une reprise suit la dernière inscription : d’organisateur à membre, et inversement', async () => {
    await inscrire(db, { phone: '+2250707123456', email: 'aya@exemple.ci', code: CODE }, T0)
    const parInvitation = await inscrire(
      db, { phone: '+2250707123456', email: 'aya@exemple.ci', code: CODE, invitation: INVITATION }, T0,
    )
    expect((await compte('+2250707123456')).organizerSince).toBeNull()

    await confirmerEmail(db, parInvitation.devToken!, T0)
    expect(alertes()).toHaveLength(0)

    // Et dans l'autre sens : d'abord par un lien, puis sans.
    await inscrire(db, { phone: '+2250707654321', email: 'koffi@exemple.ci', code: CODE, invitation: INVITATION }, T0)
    await inscrire(db, { phone: '+2250707654321', email: 'koffi@exemple.ci', code: CODE }, T1)
    expect((await compte('+2250707654321')).organizerSince).toEqual(T1)
  })

  it('n’écrit qu’aux administrateurs dont l’adresse est confirmée', async () => {
    // Un second administrateur amorcé par `pnpm db:admin`, jamais inscrit : il
    // n'a pas d'adresse, et ne peut de toute façon pas ouvrir le back-office.
    vi.stubEnv('NUXT_ADMIN_PHONES', `${ADMIN.phone}, 05 00 00 00 02`)
    await createTestUser(db, 'adad0000-0000-4000-8000-000000000002', '+2250500000002')

    await inscritEtConfirme('+2250707123456')

    expect(alertes().map(a => a.to)).toEqual([ADMIN_EMAIL])
  })

  it('sans administrateur configuré, rien ne part et l’inscription aboutit', async () => {
    vi.stubEnv('NUXT_ADMIN_PHONES', '')

    const organisateur = await inscritEtConfirme('+2250707123456')

    expect(organisateur.emailVerifiedAt).toEqual(T0)
    expect(alertes()).toHaveLength(0)
  })

  it('une panne d’envoi de l’alerte ne fait pas échouer la confirmation', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    utiliserFournisseurEmail({
      nom: 'capricieux',
      async envoyer(e) {
        if (e.subject === 'Nouvel organisateur sur eTontine') throw new Error('fournisseur en panne')
        envoyes.push(e)
      },
    })

    const organisateur = await inscritEtConfirme('+2250707123456')

    // Le compte est ouvert, et l'arrivée reste signalée au back-office :
    // l'e-mail est un rappel, pas la seule trace.
    expect(organisateur.emailVerifiedAt).toEqual(T0)
    expect(await nombreNouveauxOrganisateurs(db)).toBe(1)
  })

  it('sans adresse de back-office configurée, l’alerte dit où regarder sans inventer de lien', async () => {
    vi.stubEnv('NUXT_ADMIN_SITE_URL', '')
    await inscritEtConfirme('+2250707123456')

    expect(alertes()[0]!.text).toContain('onglet « Organisateurs »')
    expect(alertes()[0]!.text).not.toMatch(/https?:\/\//)
  })

  it('le schéma n’accepte qu’un jeton d’invitation de la forme base64url', () => {
    const base = { phone: '0707123456', email: 'aya@exemple.ci', code: CODE }
    expect(registerInput.safeParse({ ...base, invitation: INVITATION }).success).toBe(true)
    expect(registerInput.safeParse(base).success).toBe(true)

    // Le jeton finit dans le lien de confirmation : rien qui sorte du chemin.
    for (const malforme of ['../../app', 'a/b', 'court', `${INVITATION}?x=1`, 'é'.repeat(20)]) {
      expect(registerInput.safeParse({ ...base, invitation: malforme }).success, malforme).toBe(false)
    }
  })
})

describe('promotion — un membre qui crée sa première tontine', () => {
  it('devient organisateur, et l’alerte part — une seule fois', async () => {
    const membre = await inscritEtConfirme('+2250707123456', { invitation: INVITATION })
    expect(membre.organizerSince).toBeNull()

    await creerBrouillon(db, membre.id, { name: 'Tontine des tantines', access: 'private' })

    expect((await compte('+2250707123456')).organizerSince).not.toBeNull()
    expect(alertes()).toHaveLength(1)

    await creerBrouillon(db, membre.id, { name: 'Seconde tontine', access: 'private' })
    expect(alertes()).toHaveLength(1)
  })

  it('un organisateur qui crée une tontine n’est pas signalé une seconde fois', async () => {
    const organisateur = await inscritEtConfirme('+2250707123456')
    expect(alertes()).toHaveLength(1)

    await creerBrouillon(db, organisateur.id, { name: 'Tontine des tantines', access: 'private' })

    expect(alertes()).toHaveLength(1)
    expect((await compte('+2250707123456')).organizerSince).toEqual(T0)
  })

  it('est idempotente : seul le premier appel promeut', async () => {
    const membre = await inscritEtConfirme('+2250707123456', { invitation: INVITATION })

    expect(await promouvoirOrganisateur(db, membre.id, T1)).toBe(true)
    expect(await promouvoirOrganisateur(db, membre.id, new Date())).toBe(false)
    expect((await compte('+2250707123456')).organizerSince).toEqual(T1)
  })

  it('un compte jamais confirmé est marqué, sans alerte : elle partira à la confirmation', async () => {
    const id = 'cccc0000-0000-4000-8000-000000000001'
    await createTestUser(db, id, '+2250707123456')

    expect(await promouvoirOrganisateur(db, id, T0)).toBe(true)
    expect(alertes()).toHaveLength(0)
  })

  it('l’alerte se contente des quatre derniers chiffres', async () => {
    expect(await alerterAdministrateurs(db, { phone: '+2250707998877' })).toBe(1)
    expect(alertes()[0]!.text).toContain('8877')
    expect(alertes()[0]!.text).not.toContain('0707998877')
  })
})

describe('back-office — la file des organisateurs', () => {
  it('liste les nouveaux du plus ancien au plus récent, sans les membres ni les comptes non confirmés', async () => {
    const ancien = await inscritEtConfirme('+2250707000001', { quand: T0 })
    const recent = await inscritEtConfirme('+2250707000002', { quand: T1 })
    await inscritEtConfirme('+2250707000003', { invitation: INVITATION })
    // Inscrit sans lien, mais jamais confirmé : ce n'est encore personne.
    await inscrire(db, { phone: '+2250707000004', email: 'fantome@exemple.ci', code: CODE }, T0)

    // Une file à traiter commence par qui attend depuis le plus longtemps.
    expect((await organisateurs(db, 'nouveaux')).map(o => o.userId)).toEqual([ancien.id, recent.id])
    // La liste complète, elle, commence par la dernière arrivée.
    expect((await organisateurs(db, 'tous')).map(o => o.userId)).toEqual([recent.id, ancien.id])
    expect(await nombreNouveauxOrganisateurs(db)).toBe(2)
  })

  it('dit l’état de l’identité, le palier et les tontines présidées', async () => {
    const organisateur = await inscritEtConfirme('+2250707000001')
    await creerBrouillon(db, organisateur.id, { name: 'Tontine des tantines', access: 'private' })

    const [fiche] = await organisateurs(db, 'nouveaux')
    expect(fiche).toMatchObject({
      phone: '+2250707000001',
      email: '07000001@exemple.ci',
      kycStatus: 'none',
      palier: 'free',
      tontines: { brouillons: 1, actives: 0, terminees: 0 },
      seenAt: null,
    })
    expect(fiche!.organizerSince).toEqual(T0)
  })

  it('ne livre ni l’empreinte du code ni l’emplacement des pièces', async () => {
    const organisateur = await inscritEtConfirme('+2250707000001')
    await db.update(users)
      .set({ kycDocumentUrl: '/api/v1/uploads/proof/x/piece.jpg' })
      .where(eq(users.id, organisateur.id))

    const texte = JSON.stringify(await organisateurs(db, 'tous'))
    expect(texte).not.toContain(organisateur.pinHash!)
    expect(texte).not.toMatch(/pinHash|uploads/)
  })

  it('prendre en compte retire l’alerte, une seule fois, et le geste est journalisé', async () => {
    const organisateur = await inscritEtConfirme('+2250707000001')

    const resultat = await prendreEnCompteOrganisateur(db, organisateur.id, ADMIN, T1)
    expect(resultat).toEqual({ userId: organisateur.id, seenAt: T1 })

    expect(await nombreNouveauxOrganisateurs(db)).toBe(0)
    expect(await organisateurs(db, 'nouveaux')).toEqual([])
    expect((await organisateurs(db, 'tous'))[0]!.seenAt).toEqual(T1)
    expect((await compte('+2250707000001')).organizerSeenBy).toBe(ADMIN.id)

    // Une alerte qui disparaît a un auteur.
    const journal = await db.select().from(adminAudit)
    expect(journal).toHaveLength(1)
    expect(journal[0]).toMatchObject({
      action: 'organisateur_pris_en_compte',
      actorId: ADMIN.id,
      actorPhone: ADMIN.phone,
      targetUserId: organisateur.id,
    })

    await expect(prendreEnCompteOrganisateur(db, organisateur.id, ADMIN)).rejects.toThrow(
      expect.objectContaining({ statusCode: 409 }),
    )
    expect(await db.select().from(adminAudit)).toHaveLength(1)
  })

  it('refuse ce qui n’est pas un organisateur', async () => {
    const membre = await inscritEtConfirme('+2250707000003', { invitation: INVITATION })

    for (const id of [membre.id, 'eeee0000-0000-4000-8000-000000000009']) {
      await expect(prendreEnCompteOrganisateur(db, id, ADMIN)).rejects.toThrow(
        expect.objectContaining({ statusCode: 404 }),
      )
    }
  })
})
