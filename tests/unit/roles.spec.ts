import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import {
  aDejaPrisLaMain, ajouterMembreGere, attribuerParts, declarerDefaillant, definirRole,
  retirerMembre, transfererPresidence,
} from '../../server/services/membres.ts'
import { envoyerRappels } from '../../server/services/rappels.ts'
import { creerCanal, marquerVerifie } from '../../server/services/canaux.ts'
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
let cleanup: () => void
let T: string

const PRESIDENT = 'a1000000-0000-4000-8000-000000000001'
const KOFFI = 'a1000000-0000-4000-8000-000000000002'
const FATOU = 'a1000000-0000-4000-8000-000000000003'

/** Échéance du tour 1 : 15 janvier 2026. */
const A = (jour: string) => new Date(`${jour}T08:00:00`)

beforeEach(async () => {
  const ctx = createTestDb()
  db = ctx.db
  cleanup = ctx.cleanup

  await createTestUser(db, PRESIDENT, '+2250707100001')
  await createTestUser(db, KOFFI, '+2250707100002')
  await createTestUser(db, FATOU, '+2250707100003')

  T = creerBrouillon(db, PRESIDENT, { name: 'Tontine des tantines', access: 'private' })
  majTontine(db, T, { shareAmount: 25_000, frequency: 'monthly', startDate: '2026-01-15' })

  const [msPresident] = db.select().from(memberships).where(eq(memberships.tontineId, T)).all()
  attribuerParts(db, T, msPresident!.id, 1)

  // Koffi et Fatou ont un compte ; Yao est géré, sans application.
  const koffi = ajouterMembreGere(db, T, { name: 'Koffi N’Guessan', phone: '+2250707100002', shares: 1 })
  db.update(memberships).set({ userId: KOFFI }).where(eq(memberships.id, koffi)).run()
  const fatou = ajouterMembreGere(db, T, { name: 'Fatou Diarra', phone: '+2250707100003', shares: 1 })
  db.update(memberships).set({ userId: FATOU }).where(eq(memberships.id, fatou)).run()
  ajouterMembreGere(db, T, { name: 'Yao Brou', phone: '+2250707100004', shares: 1 })

  const canal = creerCanal(db, PRESIDENT, {
    provider: 'wave', msisdn: '+2250707100001', holderName: 'Aya Koné',
  })
  marquerVerifie(db, canal)
  definirCanaux(db, T, [canal], PRESIDENT)
  publier(db, T)
})

afterEach(() => cleanup())

/** Une erreur de l'API : le statut HTTP, et le message lisible dans `data.error`. */
function erreur(statut: number, motif: RegExp) {
  return expect.objectContaining({
    statusCode: statut,
    data: { error: expect.objectContaining({ message: expect.stringMatching(motif) }) },
  })
}

function adhesion(nomOuUser: string) {
  return db.select().from(memberships).where(eq(memberships.tontineId, T)).all()
    .find(m => m.userId === nomOuUser || m.managedName === nomOuUser)!
}

function president() {
  return db.select().from(memberships)
    .where(and(eq(memberships.tontineId, T), eq(memberships.role, 'president')))
    .all()
}

describe('nommer le bureau', () => {
  it('nomme un trésorier et un censeur, et l’écrit au registre', () => {
    definirRole(db, T, adhesion(KOFFI).id, 'treasurer', PRESIDENT)
    definirRole(db, T, adhesion(FATOU).id, 'auditor', PRESIDENT)

    expect(adhesion(KOFFI).role).toBe('treasurer')
    expect(adhesion(FATOU).role).toBe('auditor')

    const ecritures = db.select().from(ledgerEntries).where(eq(ledgerEntries.tontineId, T)).all()
      .filter(e => (e.payload as { changement?: string }).changement === 'role_modifie')
    expect(ecritures).toHaveLength(2)
    expect(ecritures[0]!.payload).toMatchObject({ de: 'member', vers: 'treasurer', name: 'Koffi N’Guessan' })
  })

  it('prévient la personne nommée, sans montant', () => {
    definirRole(db, T, adhesion(KOFFI).id, 'treasurer', PRESIDENT)

    const recues = db.select().from(notifications).where(eq(notifications.userId, KOFFI)).all()
    expect(recues).toHaveLength(1)
    expect(recues[0]!.body).toContain('trésorier')
  })

  it('accepte de nommer un membre qui n’a pas encore de compte, sans le notifier', () => {
    // « Koffi sera trésorier, il installe l'application demain » : le rôle
    // prend effet au rattachement. Personne à notifier en attendant.
    definirRole(db, T, adhesion('Yao Brou').id, 'treasurer', PRESIDENT)
    expect(adhesion('Yao Brou').role).toBe('treasurer')
    expect(db.select().from(notifications).all()).toHaveLength(0)
  })

  it('refuse de rétrograder le président par ce chemin', () => {
    expect(() => definirRole(db, T, adhesion(PRESIDENT).id, 'member', PRESIDENT))
      .toThrow(erreur(403, /présidence/))
    expect(president()).toHaveLength(1)
  })

  it('ne fait rien quand le rôle ne change pas', () => {
    definirRole(db, T, adhesion(KOFFI).id, 'member', PRESIDENT)
    const ecritures = db.select().from(ledgerEntries).where(eq(ledgerEntries.tontineId, T)).all()
    expect(ecritures.filter(e => (e.payload as { changement?: string }).changement === 'role_modifie'))
      .toHaveLength(0)
  })

  it('retire un rôle en repassant à membre', () => {
    definirRole(db, T, adhesion(KOFFI).id, 'treasurer', PRESIDENT)
    definirRole(db, T, adhesion(KOFFI).id, 'member', PRESIDENT)
    expect(adhesion(KOFFI).role).toBe('member')
  })
})

describe('passer la présidence', () => {
  it('fait de l’autre le président et de l’ancien un membre — un seul président', () => {
    transfererPresidence(db, T, adhesion(KOFFI).id, PRESIDENT)

    expect(adhesion(KOFFI).role).toBe('president')
    expect(adhesion(PRESIDENT).role).toBe('member')
    expect(president()).toHaveLength(1)
  })

  it('passe aussi par `role: president` sur un autre membre', () => {
    definirRole(db, T, adhesion(FATOU).id, 'president', PRESIDENT)
    expect(adhesion(FATOU).role).toBe('president')
    expect(president()).toHaveLength(1)
  })

  it('l’écrit au registre et prévient tout le groupe', () => {
    transfererPresidence(db, T, adhesion(KOFFI).id, PRESIDENT)

    const ecriture = db.select().from(ledgerEntries).where(eq(ledgerEntries.tontineId, T)).all()
      .find(e => (e.payload as { changement?: string }).changement === 'presidence_transferee')!
    expect(ecriture.payload).toMatchObject({
      de: { name: expect.any(String) },
      vers: { name: 'Koffi N’Guessan' },
    })

    // Les trois comptes sont prévenus : c'est la personne à qui l'on envoie
    // de l'argent qui change.
    const prevenus = new Set(db.select().from(notifications).all().map(n => n.userId))
    expect(prevenus).toEqual(new Set([PRESIDENT, KOFFI, FATOU]))
  })

  it('refuse un membre géré, sans compte', () => {
    expect(() => transfererPresidence(db, T, adhesion('Yao Brou').id, PRESIDENT)).toThrow(erreur(403, /compte/))
    expect(adhesion(PRESIDENT).role).toBe('president')
  })

  it('libère l’ancien président, qui peut alors sortir', () => {
    expect(() => retirerMembre(db, adhesion(PRESIDENT).id, PRESIDENT)).toThrow(erreur(403, /présidence/))

    transfererPresidence(db, T, adhesion(KOFFI).id, PRESIDENT)
    const sortie = retirerMembre(db, adhesion(PRESIDENT).id, KOFFI)

    expect(sortie.membershipId).toBe(adhesion(PRESIDENT).id)
    expect(adhesion(PRESIDENT).status).toBe('left')
  })

  it('ne touche ni aux parts ni à la rotation', () => {
    const avant = db.select().from(shares).where(eq(shares.tontineId, T)).all()
    transfererPresidence(db, T, adhesion(KOFFI).id, PRESIDENT)
    const apres = db.select().from(shares).where(eq(shares.tontineId, T)).all()
    expect(apres).toEqual(avant)
  })
})

describe('membre défaillant', () => {
  /** Clôt à la main le tour dont Koffi est bénéficiaire : il a pris la main. */
  function koffiAPrisLaMain() {
    demarrerTontine(db, T, PRESIDENT)
    const partDeKoffi = db.select().from(shares).where(eq(shares.membershipId, adhesion(KOFFI).id)).all()[0]!
    db.update(rounds).set({ status: 'closed' }).where(eq(rounds.beneficiaryShareId, partDeKoffi.id)).run()
  }

  it('refuse tant que le membre n’a pas pris la main', () => {
    demarrerTontine(db, T, PRESIDENT)
    expect(aDejaPrisLaMain(db, adhesion(KOFFI).id)).toBe(false)
    expect(() => declarerDefaillant(db, adhesion(KOFFI).id, PRESIDENT)).toThrow(erreur(403, /pris la main/))
    expect(adhesion(KOFFI).status).toBe('active')
  })

  it('passe le membre en défaillant après un tour où il a reçu le pot', () => {
    koffiAPrisLaMain()
    expect(aDejaPrisLaMain(db, adhesion(KOFFI).id)).toBe(true)

    const resultat = declarerDefaillant(db, adhesion(KOFFI).id, PRESIDENT)

    expect(adhesion(KOFFI).status).toBe('defaulted')
    // Ce qu'il doit encore sur les tours non clos : trois tours restants à 25 000.
    expect(resultat.resteDu).toBe(75_000)
  })

  it('l’écrit au registre avec le reste dû, sans prévenir le groupe', () => {
    koffiAPrisLaMain()
    declarerDefaillant(db, adhesion(KOFFI).id, PRESIDENT)

    const ecriture = db.select().from(ledgerEntries).where(eq(ledgerEntries.tontineId, T)).all()
      .find(e => (e.payload as { changement?: string }).changement === 'membre_defaillant')!
    expect(ecriture.payload).toMatchObject({ name: 'Koffi N’Guessan', resteDu: 75_000 })

    // Aucune publication (§2.2) : personne n'est notifié.
    expect(db.select().from(notifications).all()).toHaveLength(0)
  })

  it('gèle les rappels automatiques du membre défaillant', () => {
    koffiAPrisLaMain()
    // Le tour de Koffi est clos par le raccourci ci-dessus ; on ouvre le tour
    // suivant pour qu'un rappel ait un objet.
    const suivant = db.select().from(rounds).where(and(eq(rounds.tontineId, T), eq(rounds.status, 'pending'))).all()[0]!
    db.update(rounds).set({ status: 'collecting' }).where(eq(rounds.id, suivant.id)).run()

    declarerDefaillant(db, adhesion(KOFFI).id, PRESIDENT)

    const envoyes = envoyerRappels(db, A(suivant.dueDate))
    const destinataires = new Set(envoyes.map(e => e.userId))
    expect(destinataires.has(KOFFI)).toBe(false)
    // Les autres comptes, eux, sont toujours relancés.
    expect(destinataires.has(FATOU)).toBe(true)
  })

  it('est un état final', () => {
    koffiAPrisLaMain()
    declarerDefaillant(db, adhesion(KOFFI).id, PRESIDENT)
    expect(() => declarerDefaillant(db, adhesion(KOFFI).id, PRESIDENT)).toThrow(erreur(409, /final/))
    expect(() => retirerMembre(db, adhesion(KOFFI).id, PRESIDENT)).toThrow(erreur(409, /final/))
  })

  it('ne se pose jamais sur le président', () => {
    demarrerTontine(db, T, PRESIDENT)
    expect(() => declarerDefaillant(db, adhesion(PRESIDENT).id, PRESIDENT)).toThrow(erreur(403, /président/))
  })
})
