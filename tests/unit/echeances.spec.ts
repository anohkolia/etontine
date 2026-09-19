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
let cleanup: () => Promise<void>
let T: string

const PRESIDENT = 'a1000000-0000-4000-8000-000000000001'

/** Une tontine lancée, quatre parts, démarrée le 15 janvier 2026. */
async function tontineLancee(graceDays: number, depart = '2026-01-15') {
  T = (await creerBrouillon(db, PRESIDENT, { name: 'Tontine des tantines', access: 'private' }))
  await majTontine(db, T, { shareAmount: 25_000, frequency: 'monthly', startDate: depart, graceDays })

  // Quatre cotisants : le président, lui, ne cotise pas.
  await ajouterMembreGere(db, T, { name: 'Koffi', phone: '+2250707000002', shares: 1 })
  await ajouterMembreGere(db, T, { name: 'Fatou', phone: '+2250707000003', shares: 1 })
  await ajouterMembreGere(db, T, { name: 'Yao', phone: '+2250707000004', shares: 1 })
  await ajouterMembreGere(db, T, { name: 'Mariam', phone: '+2250707000005', shares: 1 })

  const canal = await creerCanal(db, PRESIDENT, { provider: 'wave', msisdn: '+2250707000001', holderName: 'Aya' })
  await marquerVerifie(db, canal)
  await definirCanaux(db, T, [canal], PRESIDENT)
  await publier(db, T)
  await demarrerTontine(db, T, PRESIDENT)
}

beforeEach(async () => {
  const ctx = await createTestDb()
  db = ctx.db
  cleanup = ctx.cleanup
  await createTestUser(db, PRESIDENT, '+2250707000001')
})

afterEach(() => cleanup())

describe('mark-late — délai de grâce', () => {
  it('ne marque rien avant l’échéance', async () => {
    await tontineLancee(3)
    // Le 14 janvier, l'échéance du 15 n'est pas encore passée.
    expect(await marquerRetards(db, new Date('2026-01-14T12:00:00Z'))).toBe(0)
  })

  it('ne marque rien pendant le délai de grâce', async () => {
    await tontineLancee(3)
    // Le 17, on est encore dans les trois jours de grâce : quelqu'un qui envoie
    // son argent le lendemain du jour dit n'est pas un retardataire.
    expect(await marquerRetards(db, new Date('2026-01-17T12:00:00Z'))).toBe(0)
  })

  it('marque une fois le délai de grâce dépassé', async () => {
    await tontineLancee(3)
    const marquees = await marquerRetards(db, new Date('2026-01-19T12:00:00Z'))

    // Quatre parts, donc quatre cotisations sur le tour ouvert.
    expect(marquees).toBe(4)

    const enRetard = (await db
      .select()
      .from(contributions))
      .filter(c => c.status === 'late')
    expect(enRetard).toHaveLength(4)
  })

  it('respecte un délai de grâce à zéro', async () => {
    await tontineLancee(0)
    expect(await marquerRetards(db, new Date('2026-01-15T12:00:00Z'))).toBe(4)
  })

  it('est idempotente : la relancer ne remarque rien', async () => {
    await tontineLancee(3)
    expect(await marquerRetards(db, new Date('2026-01-19T12:00:00Z'))).toBe(4)
    expect(await marquerRetards(db, new Date('2026-01-19T12:00:00Z'))).toBe(0)
    expect(await marquerRetards(db, new Date('2026-02-19T12:00:00Z'))).toBe(0)
  })

  it('ne touche pas une cotisation déjà déclarée', async () => {
    await tontineLancee(3)
    const [premiere] = await db.select().from(contributions)
    await db.update(contributions).set({ status: 'declared' }).where(eq(contributions.id, premiere!.id))

    expect(await marquerRetards(db, new Date('2026-01-19T12:00:00Z'))).toBe(3)
  })

  it('ne touche que les tours ouverts à la cotisation', async () => {
    await tontineLancee(3)
    // Les tours 2 à 4 sont `pending` : leurs cotisations ne sont pas encore dues.
    await marquerRetards(db, new Date('2026-12-31T12:00:00Z'))

    const tours = await db.select().from(rounds).where(eq(rounds.tontineId, T))
    const tour1 = tours.find(t => t.index === 1)!
    const autres = tours.filter(t => t.index > 1).map(t => t.id)

    const toutes = await db.select().from(contributions)
    expect(toutes.filter(c => c.roundId === tour1.id).every(c => c.status === 'late')).toBe(true)
    expect(toutes.filter(c => autres.includes(c.roundId)).every(c => c.status === 'due')).toBe(true)
  })

  it('ignore une tontine qui n’est pas lancée', async () => {
    await tontineLancee(0)
    await db.update(tontines).set({ status: 'closed' }).where(eq(tontines.id, T))
    expect(await marquerRetards(db, new Date('2026-06-01T12:00:00Z'))).toBe(0)
  })
})

describe('open-next-round — un seul tour ouvert à la fois', () => {
  it('n’ouvre rien tant qu’un tour est en cours', async () => {
    await tontineLancee(0)
    // Le tour 1 est déjà `collecting` depuis le démarrage.
    expect(await ouvrirTourSuivant(db, new Date('2026-06-01T12:00:00Z'))).toBe(0)
  })

  it('ouvre le tour suivant une fois le précédent clos', async () => {
    await tontineLancee(0)
    const tours = await db.select().from(rounds).where(eq(rounds.tontineId, T))
    const tour1 = tours.find(t => t.index === 1)!
    await db.update(rounds).set({ status: 'closed' }).where(eq(rounds.id, tour1.id))

    expect(await ouvrirTourSuivant(db, new Date('2026-02-15T12:00:00Z'))).toBe(1)

    const apres = await db.select().from(rounds).where(eq(rounds.tontineId, T))
    expect(apres.find(t => t.index === 2)!.status).toBe('collecting')
    expect(apres.find(t => t.index === 3)!.status).toBe('pending')
  })

  it('n’ouvre pas un tour dont la date n’est pas arrivée', async () => {
    await tontineLancee(0)
    const tours = await db.select().from(rounds).where(eq(rounds.tontineId, T))
    await db.update(rounds).set({ status: 'closed' }).where(eq(rounds.id, tours.find(t => t.index === 1)!.id))

    // Le tour 2 tombe le 15 février : le 20 janvier, il n'est pas encore temps.
    expect(await ouvrirTourSuivant(db, new Date('2026-01-20T12:00:00Z'))).toBe(0)
  })

  it('n’ouvre pas non plus quand un versement est en attente', async () => {
    // Deux tours ouverts en parallèle mélangeraient les cotisations sur le même
    // canal de collecte : plus personne ne saurait à quel pot appartient quel envoi.
    await tontineLancee(0)
    const tours = await db.select().from(rounds).where(eq(rounds.tontineId, T))
    await db.update(rounds)
      .set({ status: 'payout_pending' })
      .where(eq(rounds.id, tours.find(t => t.index === 1)!.id))

    expect(await ouvrirTourSuivant(db, new Date('2026-06-01T12:00:00Z'))).toBe(0)
  })

  it('est idempotente', async () => {
    await tontineLancee(0)
    const tours = await db.select().from(rounds).where(eq(rounds.tontineId, T))
    await db.update(rounds).set({ status: 'closed' }).where(eq(rounds.id, tours.find(t => t.index === 1)!.id))

    expect(await ouvrirTourSuivant(db, new Date('2026-02-15T12:00:00Z'))).toBe(1)
    expect(await ouvrirTourSuivant(db, new Date('2026-02-15T12:00:00Z'))).toBe(0)
  })
})

describe('génération au démarrage — acceptation T13', () => {
  it('donne au bénéficiaire du tour sa propre cotisation', async () => {
    await tontineLancee(0)
    const tours = await db.select().from(rounds).where(eq(rounds.tontineId, T))

    for (const tour of tours) {
      const cotisations = await db.select().from(contributions).where(eq(contributions.roundId, tour.id))
      // Le bénéficiaire cotise comme les autres : le net lui revient au versement.
      expect(cotisations.some(c => c.shareId === tour.beneficiaryShareId)).toBe(true)
      expect(cotisations).toHaveLength(4)
    }
  })

  it('pose expected_amount = montant de part × nombre total de parts', async () => {
    await tontineLancee(0)
    const tours = await db.select().from(rounds).where(eq(rounds.tontineId, T))

    for (const tour of tours) {
      expect(tour.expectedAmount).toBe(25_000 * 4)
    }
  })

  it('crée autant de tours que de parts', async () => {
    await tontineLancee(0)
    expect(await db.select().from(rounds).where(eq(rounds.tontineId, T))).toHaveLength(4)
    expect(await db.select().from(contributions)).toHaveLength(16)
  })
})
