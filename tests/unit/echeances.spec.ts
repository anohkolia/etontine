import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { marquerRetards, ouvrirTourSuivant } from '../../server/services/echeances.ts'
import { ajouterMembreGere } from '../../server/services/membres.ts'
import { creerCanal, marquerVerifie } from '../../server/services/canaux.ts'
import { creerBrouillon, definirCanaux, majTontine, publier } from '../../server/services/tontines.ts'
import { demarrerTontine } from '../../server/services/tours.ts'
import { contributions, rounds, tontines } from '../../server/db/schema.ts'
import { createTestDb, createTestUser } from '../helpers/db.ts'
import type { TestDb } from '../helpers/db.ts'

let db: TestDb
let cleanup: () => void
let T: string

const PRESIDENT = 'a1000000-0000-4000-8000-000000000001'

/** Une tontine lancée, quatre parts, démarrée le 15 janvier 2026. */
function tontineLancee(graceDays: number, depart = '2026-01-15') {
  T = creerBrouillon(db, PRESIDENT, { name: 'Tontine des tantines', access: 'private' })
  majTontine(db, T, { shareAmount: 25_000, frequency: 'monthly', startDate: depart, graceDays })

  ajouterMembreGere(db, T, { name: 'Koffi', phone: '+2250707000002', shares: 1 })
  ajouterMembreGere(db, T, { name: 'Fatou', phone: '+2250707000003', shares: 1 })
  ajouterMembreGere(db, T, { name: 'Yao', phone: '+2250707000004', shares: 1 })

  const canal = creerCanal(db, PRESIDENT, { provider: 'wave', msisdn: '+2250707000001', holderName: 'Aya' })
  marquerVerifie(db, canal)
  definirCanaux(db, T, [canal], PRESIDENT)
  publier(db, T)
  demarrerTontine(db, T, PRESIDENT)
}

beforeEach(async () => {
  const ctx = createTestDb()
  db = ctx.db
  cleanup = ctx.cleanup
  await createTestUser(db, PRESIDENT, '+2250707000001')
})

afterEach(() => cleanup())

describe('mark-late — délai de grâce', () => {
  it('ne marque rien avant l’échéance', () => {
    tontineLancee(3)
    // Le 14 janvier, l'échéance du 15 n'est pas encore passée.
    expect(marquerRetards(db, new Date('2026-01-14T12:00:00Z'))).toBe(0)
  })

  it('ne marque rien pendant le délai de grâce', () => {
    tontineLancee(3)
    // Le 17, on est encore dans les trois jours de grâce : quelqu'un qui envoie
    // son argent le lendemain du jour dit n'est pas un retardataire.
    expect(marquerRetards(db, new Date('2026-01-17T12:00:00Z'))).toBe(0)
  })

  it('marque une fois le délai de grâce dépassé', () => {
    tontineLancee(3)
    const marquees = marquerRetards(db, new Date('2026-01-19T12:00:00Z'))

    // Quatre parts, donc quatre cotisations sur le tour ouvert.
    expect(marquees).toBe(4)

    const enRetard = db
      .select()
      .from(contributions)
      .all()
      .filter(c => c.status === 'late')
    expect(enRetard).toHaveLength(4)
  })

  it('respecte un délai de grâce à zéro', () => {
    tontineLancee(0)
    expect(marquerRetards(db, new Date('2026-01-15T12:00:00Z'))).toBe(4)
  })

  it('est idempotente : la relancer ne remarque rien', () => {
    tontineLancee(3)
    expect(marquerRetards(db, new Date('2026-01-19T12:00:00Z'))).toBe(4)
    expect(marquerRetards(db, new Date('2026-01-19T12:00:00Z'))).toBe(0)
    expect(marquerRetards(db, new Date('2026-02-19T12:00:00Z'))).toBe(0)
  })

  it('ne touche pas une cotisation déjà déclarée', () => {
    tontineLancee(3)
    const [premiere] = db.select().from(contributions).all()
    db.update(contributions).set({ status: 'declared' }).where(eq(contributions.id, premiere!.id)).run()

    expect(marquerRetards(db, new Date('2026-01-19T12:00:00Z'))).toBe(3)
  })

  it('ne touche que les tours ouverts à la cotisation', () => {
    tontineLancee(3)
    // Les tours 2 à 4 sont `pending` : leurs cotisations ne sont pas encore dues.
    marquerRetards(db, new Date('2026-12-31T12:00:00Z'))

    const tours = db.select().from(rounds).where(eq(rounds.tontineId, T)).all()
    const tour1 = tours.find(t => t.index === 1)!
    const autres = tours.filter(t => t.index > 1).map(t => t.id)

    const toutes = db.select().from(contributions).all()
    expect(toutes.filter(c => c.roundId === tour1.id).every(c => c.status === 'late')).toBe(true)
    expect(toutes.filter(c => autres.includes(c.roundId)).every(c => c.status === 'due')).toBe(true)
  })

  it('ignore une tontine qui n’est pas lancée', () => {
    tontineLancee(0)
    db.update(tontines).set({ status: 'closed' }).where(eq(tontines.id, T)).run()
    expect(marquerRetards(db, new Date('2026-06-01T12:00:00Z'))).toBe(0)
  })
})

describe('open-next-round — un seul tour ouvert à la fois', () => {
  it('n’ouvre rien tant qu’un tour est en cours', () => {
    tontineLancee(0)
    // Le tour 1 est déjà `collecting` depuis le démarrage.
    expect(ouvrirTourSuivant(db, new Date('2026-06-01T12:00:00Z'))).toBe(0)
  })

  it('ouvre le tour suivant une fois le précédent clos', () => {
    tontineLancee(0)
    const tours = db.select().from(rounds).where(eq(rounds.tontineId, T)).all()
    const tour1 = tours.find(t => t.index === 1)!
    db.update(rounds).set({ status: 'closed' }).where(eq(rounds.id, tour1.id)).run()

    expect(ouvrirTourSuivant(db, new Date('2026-02-15T12:00:00Z'))).toBe(1)

    const apres = db.select().from(rounds).where(eq(rounds.tontineId, T)).all()
    expect(apres.find(t => t.index === 2)!.status).toBe('collecting')
    expect(apres.find(t => t.index === 3)!.status).toBe('pending')
  })

  it('n’ouvre pas un tour dont la date n’est pas arrivée', () => {
    tontineLancee(0)
    const tours = db.select().from(rounds).where(eq(rounds.tontineId, T)).all()
    db.update(rounds).set({ status: 'closed' }).where(eq(rounds.id, tours.find(t => t.index === 1)!.id)).run()

    // Le tour 2 tombe le 15 février : le 20 janvier, il n'est pas encore temps.
    expect(ouvrirTourSuivant(db, new Date('2026-01-20T12:00:00Z'))).toBe(0)
  })

  it('n’ouvre pas non plus quand un versement est en attente', () => {
    // Deux tours ouverts en parallèle mélangeraient les cotisations sur le même
    // canal de collecte : plus personne ne saurait à quel pot appartient quel envoi.
    tontineLancee(0)
    const tours = db.select().from(rounds).where(eq(rounds.tontineId, T)).all()
    db.update(rounds)
      .set({ status: 'payout_pending' })
      .where(eq(rounds.id, tours.find(t => t.index === 1)!.id))
      .run()

    expect(ouvrirTourSuivant(db, new Date('2026-06-01T12:00:00Z'))).toBe(0)
  })

  it('est idempotente', () => {
    tontineLancee(0)
    const tours = db.select().from(rounds).where(eq(rounds.tontineId, T)).all()
    db.update(rounds).set({ status: 'closed' }).where(eq(rounds.id, tours.find(t => t.index === 1)!.id)).run()

    expect(ouvrirTourSuivant(db, new Date('2026-02-15T12:00:00Z'))).toBe(1)
    expect(ouvrirTourSuivant(db, new Date('2026-02-15T12:00:00Z'))).toBe(0)
  })
})

describe('génération au démarrage — acceptation T13', () => {
  it('donne au bénéficiaire du tour sa propre cotisation', () => {
    tontineLancee(0)
    const tours = db.select().from(rounds).where(eq(rounds.tontineId, T)).all()

    for (const tour of tours) {
      const cotisations = db.select().from(contributions).where(eq(contributions.roundId, tour.id)).all()
      // Le bénéficiaire cotise comme les autres : le net lui revient au versement.
      expect(cotisations.some(c => c.shareId === tour.beneficiaryShareId)).toBe(true)
      expect(cotisations).toHaveLength(4)
    }
  })

  it('pose expected_amount = montant de part × nombre total de parts', () => {
    tontineLancee(0)
    const tours = db.select().from(rounds).where(eq(rounds.tontineId, T)).all()

    for (const tour of tours) {
      expect(tour.expectedAmount).toBe(25_000 * 4)
    }
  })

  it('crée autant de tours que de parts', () => {
    tontineLancee(0)
    expect(db.select().from(rounds).where(eq(rounds.tontineId, T)).all()).toHaveLength(4)
    expect(db.select().from(contributions).all()).toHaveLength(16)
  })
})
