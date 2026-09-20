import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import {
  aDejaPrisLaMain, ajouterMembreGere, attribuerParts, declarerDefaillant, definirRole,
  retirerMembre, transfererPresidence,
} from '../../server/services/membres.ts'
import { envoyerRappels } from '../../server/services/rappels.ts'
import { creerCanal } from '../../server/services/canaux.ts'
import { creerBrouillon, definirCanaux, majTontine, publier } from '../../server/services/tontines.ts'
import { demarrerTontine } from '../../server/services/tours.ts'
import { ledgerEntries, memberships, notifications, rounds, shares } from '../../server/db/schema.ts'
import { createTestDb, createTestUser } from '../helpers/db.ts'
import type { TestDb } from '../helpers/db.ts'

/**
 * Rôles du bureau, transfert de présidence, membre défaillant.
 *
 * Ces trois gestes existaient dans la matrice de permissions (data-model §3)
 * et dans la machine à états des adhésions (§2.2) sans qu'aucun chemin ne les
 * déclenche. Sans trésorier ni censeur, chaque tontine gardait un bureau d'une
 * seule personne — et toute la séparation des pouvoirs restait théorique.
 */

let db: TestDb
let cleanup: () => Promise<void>
let T: string

const PRESIDENT = 'a1000000-0000-4000-8000-000000000001'
const KOFFI = 'a1000000-0000-4000-8000-000000000002'
const FATOU = 'a1000000-0000-4000-8000-000000000003'

/** Échéance du tour 1 : 15 janvier 2026. */
const A = (jour: string) => new Date(`${jour}T08:00:00`)

beforeEach(async () => {
  const ctx = await createTestDb()
  db = ctx.db
  cleanup = ctx.cleanup

  await createTestUser(db, PRESIDENT, '+2250707100001')
  await createTestUser(db, KOFFI, '+2250707100002')
  await createTestUser(db, FATOU, '+2250707100003')

  T = (await creerBrouillon(db, PRESIDENT, { name: 'Tontine des tantines', access: 'private' }))
  await majTontine(db, T, { shareAmount: 25_000, frequency: 'monthly', startDate: '2026-01-15' })

  // Le président ne cotise pas : quatre cotisants, quatre parts, quatre tours.
  // Koffi et Fatou ont un compte ; Yao et Mariam sont gérés, sans application.
  const koffi = await ajouterMembreGere(db, T, { name: 'Koffi N’Guessan', phone: '+2250707100002', shares: 1 })
  await db.update(memberships).set({ userId: KOFFI }).where(eq(memberships.id, koffi))
  const fatou = await ajouterMembreGere(db, T, { name: 'Fatou Diarra', phone: '+2250707100003', shares: 1 })
  await db.update(memberships).set({ userId: FATOU }).where(eq(memberships.id, fatou))
  await ajouterMembreGere(db, T, { name: 'Yao Brou', phone: '+2250707100004', shares: 1 })
  await ajouterMembreGere(db, T, { name: 'Mariam Touré', phone: '+2250707100005', shares: 1 })

  const canal = await creerCanal(db, PRESIDENT, {
    provider: 'wave', msisdn: '+2250707100001', holderName: 'Aya Koné',
  })
  await definirCanaux(db, T, [canal], PRESIDENT)
  await publier(db, T)
})

afterEach(() => cleanup())

/** Une erreur de l'API : le statut HTTP, et le message lisible dans `data.error`. */
function erreur(statut: number, motif: RegExp) {
  return expect.objectContaining({
    statusCode: statut,
    data: { error: expect.objectContaining({ message: expect.stringMatching(motif) }) },
  })
}

async function adhesion(nomOuUser: string) {
  return (await db.select().from(memberships).where(eq(memberships.tontineId, T)))
    .find(m => m.userId === nomOuUser || m.managedName === nomOuUser)!
}

async function president() {
  return await db.select().from(memberships)
    .where(and(eq(memberships.tontineId, T), eq(memberships.role, 'president')))
}

describe('nommer le bureau', () => {
  it('nomme un trésorier et un censeur, et l’écrit au registre', async () => {
    await definirRole(db, T, (await adhesion(KOFFI)).id, 'treasurer', PRESIDENT)
    await definirRole(db, T, (await adhesion(FATOU)).id, 'auditor', PRESIDENT)

    expect((await adhesion(KOFFI)).role).toBe('treasurer')
    expect((await adhesion(FATOU)).role).toBe('auditor')

    const ecritures = (await db.select().from(ledgerEntries).where(eq(ledgerEntries.tontineId, T)))
      .filter(e => (e.payload as { changement?: string }).changement === 'role_modifie')
    expect(ecritures).toHaveLength(2)
    expect(ecritures[0]!.payload).toMatchObject({ de: 'member', vers: 'treasurer', name: 'Koffi N’Guessan' })
  })

  it('prévient la personne nommée, sans montant', async () => {
    await definirRole(db, T, (await adhesion(KOFFI)).id, 'treasurer', PRESIDENT)

    const recues = await db.select().from(notifications).where(eq(notifications.userId, KOFFI))
    expect(recues).toHaveLength(1)
    expect(recues[0]!.body).toContain('trésorier')
  })

  it('accepte de nommer un membre qui n’a pas encore de compte, sans le notifier', async () => {
    // « Koffi sera trésorier, il installe l'application demain » : le rôle
    // prend effet au rattachement. Personne à notifier en attendant.
    await definirRole(db, T, (await adhesion('Yao Brou')).id, 'treasurer', PRESIDENT)
    expect((await adhesion('Yao Brou')).role).toBe('treasurer')
    expect(await db.select().from(notifications)).toHaveLength(0)
  })

  it('refuse de rétrograder le président par ce chemin', async () => {
    await expect(definirRole(db, T, (await adhesion(PRESIDENT)).id, 'member', PRESIDENT)).rejects
      .toThrow(erreur(403, /présidence/))
    expect(await president()).toHaveLength(1)
  })

  it('ne fait rien quand le rôle ne change pas', async () => {
    await definirRole(db, T, (await adhesion(KOFFI)).id, 'member', PRESIDENT)
    const ecritures = await db.select().from(ledgerEntries).where(eq(ledgerEntries.tontineId, T))
    expect(ecritures.filter(e => (e.payload as { changement?: string }).changement === 'role_modifie'))
      .toHaveLength(0)
  })

  it('retire un rôle en repassant à membre', async () => {
    await definirRole(db, T, (await adhesion(KOFFI)).id, 'treasurer', PRESIDENT)
    await definirRole(db, T, (await adhesion(KOFFI)).id, 'member', PRESIDENT)
    expect((await adhesion(KOFFI)).role).toBe('member')
  })
})

describe('passer la présidence', () => {
  it('fait de l’autre le président et de l’ancien un membre — un seul président', async () => {
    await transfererPresidence(db, T, (await adhesion(KOFFI)).id, PRESIDENT)

    expect((await adhesion(KOFFI)).role).toBe('president')
    expect((await adhesion(PRESIDENT)).role).toBe('member')
    expect(await president()).toHaveLength(1)
  })

  it('passe aussi par `role: president` sur un autre membre', async () => {
    await definirRole(db, T, (await adhesion(FATOU)).id, 'president', PRESIDENT)
    expect((await adhesion(FATOU)).role).toBe('president')
    expect(await president()).toHaveLength(1)
  })

  it('l’écrit au registre et prévient tout le groupe', async () => {
    await transfererPresidence(db, T, (await adhesion(KOFFI)).id, PRESIDENT)

    const ecriture = (await db.select().from(ledgerEntries).where(eq(ledgerEntries.tontineId, T)))
      .find(e => (e.payload as { changement?: string }).changement === 'presidence_transferee')!
    expect(ecriture.payload).toMatchObject({
      de: { name: expect.any(String) },
      vers: { name: 'Koffi N’Guessan' },
    })

    // Les trois comptes sont prévenus : c'est la personne à qui l'on envoie
    // de l'argent qui change.
    const prevenus = new Set((await db.select().from(notifications)).map(n => n.userId))
    expect(prevenus).toEqual(new Set([PRESIDENT, KOFFI, FATOU]))
  })

  it('refuse un membre géré, sans compte', async () => {
    await expect(transfererPresidence(db, T, (await adhesion('Yao Brou')).id, PRESIDENT)).rejects.toThrow(erreur(403, /compte/))
    expect((await adhesion(PRESIDENT)).role).toBe('president')
  })

  it('libère l’ancien président, qui peut alors sortir', async () => {
    await expect(retirerMembre(db, (await adhesion(PRESIDENT)).id, PRESIDENT)).rejects.toThrow(erreur(403, /présidence/))

    await transfererPresidence(db, T, (await adhesion(KOFFI)).id, PRESIDENT)
    const sortie = await retirerMembre(db, (await adhesion(PRESIDENT)).id, KOFFI)

    expect(sortie.membershipId).toBe((await adhesion(PRESIDENT)).id)
    expect((await adhesion(PRESIDENT)).status).toBe('left')
  })

  it('retire ses parts au successeur — le président ne cotise pas — et laisse les autres', async () => {
    const avant = await db.select().from(shares).where(eq(shares.tontineId, T))
    const koffi = (await adhesion(KOFFI)).id

    await transfererPresidence(db, T, koffi, PRESIDENT)

    const apres = await db.select().from(shares).where(eq(shares.tontineId, T))
    expect(apres.some(part => part.membershipId === koffi)).toBe(false)
    expect(apres).toEqual(avant.filter(part => part.membershipId !== koffi))
  })

  it('laisse l’ancien président, devenu membre, prendre une part', async () => {
    await transfererPresidence(db, T, (await adhesion(KOFFI)).id, PRESIDENT)

    const ancien = (await adhesion(PRESIDENT)).id
    await attribuerParts(db, T, ancien, 1)
    expect(await db.select().from(shares).where(eq(shares.membershipId, ancien))).toHaveLength(1)
  })

  it('refuse une fois la tontine démarrée : les parts du successeur sont engagées', async () => {
    await demarrerTontine(db, T, PRESIDENT)

    await expect(transfererPresidence(db, T, (await adhesion(KOFFI)).id, PRESIDENT)).rejects.toThrow(erreur(403, /démarrage/))
    expect((await adhesion(PRESIDENT)).role).toBe('president')
    expect(await db.select().from(shares).where(eq(shares.membershipId, (await adhesion(KOFFI)).id))).toHaveLength(1)
  })
})

describe('membre défaillant', () => {
  /** Clôt à la main le tour dont Koffi est bénéficiaire : il a pris la main. */
  async function koffiAPrisLaMain() {
    await demarrerTontine(db, T, PRESIDENT)
    const partDeKoffi = (await db.select().from(shares).where(eq(shares.membershipId, (await adhesion(KOFFI)).id)))[0]!
    await db.update(rounds).set({ status: 'closed' }).where(eq(rounds.beneficiaryShareId, partDeKoffi.id))
  }

  it('refuse tant que le membre n’a pas pris la main', async () => {
    await demarrerTontine(db, T, PRESIDENT)
    expect(await aDejaPrisLaMain(db, (await adhesion(KOFFI)).id)).toBe(false)
    await expect(declarerDefaillant(db, (await adhesion(KOFFI)).id, PRESIDENT)).rejects.toThrow(erreur(403, /pris la main/))
    expect((await adhesion(KOFFI)).status).toBe('active')
  })

  it('passe le membre en défaillant après un tour où il a reçu le pot', async () => {
    await koffiAPrisLaMain()
    expect(await aDejaPrisLaMain(db, (await adhesion(KOFFI)).id)).toBe(true)

    const resultat = await declarerDefaillant(db, (await adhesion(KOFFI)).id, PRESIDENT)

    expect((await adhesion(KOFFI)).status).toBe('defaulted')
    // Ce qu'il doit encore sur les tours non clos : trois tours restants à 25 000.
    expect(resultat.resteDu).toBe(75_000)
  })

  it('l’écrit au registre avec le reste dû, sans prévenir le groupe', async () => {
    await koffiAPrisLaMain()
    await declarerDefaillant(db, (await adhesion(KOFFI)).id, PRESIDENT)

    const ecriture = (await db.select().from(ledgerEntries).where(eq(ledgerEntries.tontineId, T)))
      .find(e => (e.payload as { changement?: string }).changement === 'membre_defaillant')!
    expect(ecriture.payload).toMatchObject({ name: 'Koffi N’Guessan', resteDu: 75_000 })

    // Aucune publication (§2.2) : personne n'est notifié.
    expect(await db.select().from(notifications)).toHaveLength(0)
  })

  it('gèle les rappels automatiques du membre défaillant', async () => {
    await koffiAPrisLaMain()
    // Le tour de Koffi est clos par le raccourci ci-dessus ; on ouvre le tour
    // suivant pour qu'un rappel ait un objet.
    const suivant = (await db.select().from(rounds).where(and(eq(rounds.tontineId, T), eq(rounds.status, 'pending'))))[0]!
    await db.update(rounds).set({ status: 'collecting' }).where(eq(rounds.id, suivant.id))

    await declarerDefaillant(db, (await adhesion(KOFFI)).id, PRESIDENT)

    const envoyes = await envoyerRappels(db, A(suivant.dueDate))
    const destinataires = new Set(envoyes.map(e => e.userId))
    expect(destinataires.has(KOFFI)).toBe(false)
    // Les autres comptes, eux, sont toujours relancés.
    expect(destinataires.has(FATOU)).toBe(true)
  })

  it('est un état final', async () => {
    await koffiAPrisLaMain()
    await declarerDefaillant(db, (await adhesion(KOFFI)).id, PRESIDENT)
    await expect(declarerDefaillant(db, (await adhesion(KOFFI)).id, PRESIDENT)).rejects.toThrow(erreur(409, /final/))
    await expect(retirerMembre(db, (await adhesion(KOFFI)).id, PRESIDENT)).rejects.toThrow(erreur(409, /final/))
  })

  it('ne se pose jamais sur le président', async () => {
    await demarrerTontine(db, T, PRESIDENT)
    await expect(declarerDefaillant(db, (await adhesion(PRESIDENT)).id, PRESIDENT)).rejects.toThrow(erreur(403, /président/))
  })
})
