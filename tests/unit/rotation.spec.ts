import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  ajouterMembreGere, attribuerParts, definirRotation, membresDe, rotationDe,
} from '../../server/services/membres.ts'
import { melangerAvecGraine, verifierTirage } from '../../server/services/rotation.ts'
import { dateDuTour, demarrerTontine } from '../../server/services/tours.ts'
import { creerCanal, marquerVerifie } from '../../server/services/canaux.ts'
import { creerBrouillon, definirCanaux, majTontine, publier } from '../../server/services/tontines.ts'
import { contributions, ledgerEntries, memberships, rounds, tontines } from '../../server/db/schema.ts'
import { createTestDb, createTestUser } from '../helpers/db.ts'
import type { TestDb } from '../helpers/db.ts'

let db: TestDb
let cleanup: () => void
let T: string

const PRESIDENT = 'e0000000-0000-4000-8000-000000000001'

beforeEach(async () => {
  const ctx = createTestDb()
  db = ctx.db
  cleanup = ctx.cleanup

  await createTestUser(db, PRESIDENT, '+2250707000001')
  T = creerBrouillon(db, PRESIDENT, { name: 'Tontine des tantines', access: 'private' })
  majTontine(db, T, { shareAmount: 25_000, frequency: 'monthly', startDate: '2026-01-15' })

  // Le président est déjà adhérent : on lui attribue sa part.
  const [msPresident] = db.select().from(memberships).where(eq(memberships.tontineId, T)).all()
  attribuerParts(db, T, msPresident!.id, 1)

  // Un canal vérifié, puis publication : `demarrerTontine` exige `open`, et
  // sauter la publication reviendrait à tester une transition qui n'existe pas.
  const canal = creerCanal(db, PRESIDENT, {
    provider: 'wave', msisdn: '+2250707000001', holderName: 'Aya Koné',
  })
  marquerVerifie(db, canal)
  definirCanaux(db, T, [canal], PRESIDENT)
  publier(db, T)
})

afterEach(() => cleanup())

/** Six membres, dont Yao Brou à **deux parts** — sept parts au total. */
function groupeAvecDoublePart() {
  ajouterMembreGere(db, T, { name: 'Koffi N’Guessan', phone: '+2250707000002', shares: 1 })
  ajouterMembreGere(db, T, { name: 'Fatou Diarra', phone: '+2250707000003', shares: 1 })
  const yao = ajouterMembreGere(db, T, { name: 'Yao Brou', phone: '+2250707000004', shares: 2 })
  ajouterMembreGere(db, T, { name: 'Mariam Touré', phone: '+2250707000005', shares: 1 })
  ajouterMembreGere(db, T, { name: 'Ibrahim Sanogo', phone: '+2250707000006', shares: 1 })
  return yao
}

describe('double part — le test central du modèle (T11)', () => {
  it('occupe deux positions distinctes dans la rotation', () => {
    const yao = groupeAvecDoublePart()
    const parts = rotationDe(db, T).filter(p => p.membershipId === yao)

    expect(parts).toHaveLength(2)
    expect(parts[0]!.rotationPosition).not.toBe(parts[1]!.rotationPosition)
  })

  it('apparaît deux fois dans la rotation, et une seule dans la liste des membres', () => {
    const yao = groupeAvecDoublePart()

    // La rotation raisonne sur les parts…
    expect(rotationDe(db, T).filter(p => p.membershipId === yao)).toHaveLength(2)

    // …et la liste des membres sur les adhésions, en indiquant les deux positions.
    const membres = membresDe(db, T)
    const fiche = membres.find(m => m.id === yao)
    expect(fiche!.shares).toBe(2)
    expect(fiche!.positions).toHaveLength(2)
    expect(membres.filter(m => m.id === yao)).toHaveLength(1)
  })

  it('génère deux cotisations par tour', () => {
    const yao = groupeAvecDoublePart()
    const resultat = demarrerTontine(db, T, PRESIDENT)

    // Sept parts → sept tours, et sept cotisations par tour.
    expect(resultat.rounds).toBe(7)
    expect(resultat.contributions).toBe(49)

    const tours = db.select().from(rounds).where(eq(rounds.tontineId, T)).all()
    for (const tour of tours) {
      const siennes = db
        .select()
        .from(contributions)
        .where(eq(contributions.roundId, tour.id))
        .all()
        .filter(c => c.membershipId === yao)

      expect(siennes, `tour ${tour.index}`).toHaveLength(2)
    }
  })

  it('prend la main deux fois sur le cycle', () => {
    const yao = groupeAvecDoublePart()
    demarrerTontine(db, T, PRESIDENT)

    const sesParts = new Set(
      rotationDe(db, T).filter(p => p.membershipId === yao).map(p => p.shareId),
    )
    const sesTours = db
      .select()
      .from(rounds)
      .where(eq(rounds.tontineId, T))
      .all()
      .filter(r => sesParts.has(r.beneficiaryShareId))

    expect(sesTours).toHaveLength(2)
  })

  it('cotise aussi le tour où il prend la main', () => {
    // Usage ivoirien : le bénéficiaire cotise, et le net lui revient au
    // versement. L'exclure fausserait le pot de tout le monde.
    const yao = groupeAvecDoublePart()
    demarrerTontine(db, T, PRESIDENT)

    const sesParts = new Set(
      rotationDe(db, T).filter(p => p.membershipId === yao).map(p => p.shareId),
    )
    const sonTour = db
      .select()
      .from(rounds)
      .where(eq(rounds.tontineId, T))
      .all()
      .find(r => sesParts.has(r.beneficiaryShareId))!

    const cotisations = db.select().from(contributions).where(eq(contributions.roundId, sonTour.id)).all()
    expect(cotisations.filter(c => c.membershipId === yao)).toHaveLength(2)
    expect(cotisations).toHaveLength(7)
  })

  it('pèse deux parts dans le pot attendu', () => {
    groupeAvecDoublePart()
    const { expectedAmount } = demarrerTontine(db, T, PRESIDENT)

    // 7 parts × 25 000 = 175 000, et non 6 membres × 25 000.
    expect(expectedAmount).toBe(175_000)
  })
})

describe('tirage au sort — preuve anti-soupçon', () => {
  beforeEach(() => groupeAvecDoublePart())

  it('écrit la graine et le résultat au registre', () => {
    const resultat = definirRotation(db, T, PRESIDENT, { mode: 'draw' })

    const [ecriture] = db.select().from(ledgerEntries).where(eq(ledgerEntries.type, 'rotation_changed')).all()
    expect(ecriture).toBeDefined()

    const payload = ecriture!.payload as { seed: string, order: string[], mode: string }
    expect(payload.mode).toBe('draw')
    expect(payload.seed).toBe(resultat.seed)
    expect(payload.order).toEqual(resultat.order)
  })

  it('permet de rejouer le tirage et de retrouver le même ordre', () => {
    definirRotation(db, T, PRESIDENT, { mode: 'draw' })
    const [ecriture] = db.select().from(ledgerEntries).where(eq(ledgerEntries.type, 'rotation_changed')).all()
    const payload = ecriture!.payload as { seed: string, order: string[], sharesAtDraw: string[] }

    // C'est toute la valeur du dispositif : un membre qui doute rejoue la
    // graine inscrite au registre et retrouve l'ordre annoncé.
    expect(verifierTirage(payload.sharesAtDraw, payload.seed, payload.order)).toBe(true)
  })

  it('détecte un ordre qui ne correspond pas à la graine', () => {
    const [a, b, ...reste] = melangerAvecGraine(['s1', 's2', 's3', 's4'], 'graine-x')
    expect(verifierTirage(['s1', 's2', 's3', 's4'], 'graine-x', [b!, a!, ...reste])).toBe(false)
  })

  it('donne toujours le même résultat pour une graine donnée', () => {
    const elements = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    expect(melangerAvecGraine(elements, 'graine-1')).toEqual(melangerAvecGraine(elements, 'graine-1'))
    expect(melangerAvecGraine(elements, 'graine-1')).not.toEqual(melangerAvecGraine(elements, 'graine-2'))
  })

  it('n’oublie ni ne duplique aucune part', () => {
    const elements = Array.from({ length: 20 }, (_, i) => `s${i}`)
    const melange = melangerAvecGraine(elements, 'graine-3')

    expect(melange).toHaveLength(20)
    expect(new Set(melange).size).toBe(20)
  })

  it('attribue des positions consécutives à partir de 1', () => {
    definirRotation(db, T, PRESIDENT, { mode: 'draw' })
    const positions = rotationDe(db, T).map(p => p.rotationPosition)
    expect(positions).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('refuse un ordre fixe incomplet', () => {
    const parts = rotationDe(db, T).map(p => p.shareId)
    expect(() => definirRotation(db, T, PRESIDENT, { mode: 'fixed', order: parts.slice(0, 3) }))
      .toThrow(expect.objectContaining({ statusCode: 422 }))
  })
})

describe('ordre figé après le démarrage', () => {
  it('refuse de modifier l’ordre une fois la tontine lancée', () => {
    groupeAvecDoublePart()
    demarrerTontine(db, T, PRESIDENT)

    // Acceptation T11 : après `start`, l'ordre n'est plus modifiable sans
    // contre-validation. Le déplacer en cours de cycle avantagerait quelqu'un
    // au détriment d'un autre, sur un pot déjà partiellement cotisé.
    expect(() => definirRotation(db, T, PRESIDENT, { mode: 'draw' })).toThrow(
      expect.objectContaining({ statusCode: 403 }),
    )
  })

  it('pose la date de gel au démarrage', () => {
    groupeAvecDoublePart()
    demarrerTontine(db, T, PRESIDENT)

    const [t] = db.select().from(tontines).where(eq(tontines.id, T)).all()
    expect(t!.rotationFrozenAt).not.toBeNull()
    expect(t!.status).toBe('running')
  })

  it('refuse de démarrer à moins de trois membres actifs', () => {
    ajouterMembreGere(db, T, { name: 'Koffi', phone: '+2250707000002', shares: 1 })
    expect(() => demarrerTontine(db, T, PRESIDENT)).toThrow(
      expect.objectContaining({ statusCode: 403 }),
    )
  })

  it('n’ouvre que le premier tour', () => {
    groupeAvecDoublePart()
    demarrerTontine(db, T, PRESIDENT)

    const tours = db.select().from(rounds).where(eq(rounds.tontineId, T)).all()
    expect(tours.find(t => t.index === 1)!.status).toBe('collecting')
    expect(tours.filter(t => t.index > 1).every(t => t.status === 'pending')).toBe(true)
  })
})

describe('dates des tours — les quatre fréquences', () => {
  it('journalière : un jour par tour', () => {
    expect(dateDuTour('2026-01-15', 1, 'daily')).toBe('2026-01-15')
    expect(dateDuTour('2026-01-15', 3, 'daily')).toBe('2026-01-17')
  })

  it('hebdomadaire : sept jours par tour', () => {
    expect(dateDuTour('2026-01-15', 2, 'weekly')).toBe('2026-01-22')
    expect(dateDuTour('2026-01-15', 5, 'weekly')).toBe('2026-02-12')
  })

  it('bimensuelle : quinze jours par tour', () => {
    expect(dateDuTour('2026-01-15', 2, 'biweekly')).toBe('2026-01-29')
  })

  it('mensuelle : le même jour du mois suivant', () => {
    expect(dateDuTour('2026-01-15', 2, 'monthly')).toBe('2026-02-15')
    expect(dateDuTour('2026-01-15', 13, 'monthly')).toBe('2027-01-15')
  })

  it('mensuelle : un 31 ne déborde pas sur le mois d’après', () => {
    // Le piège classique : janvier + un mois donnerait le 3 mars par simple
    // addition. Une tontine démarrée un 31 dériverait à chaque tour.
    expect(dateDuTour('2026-01-31', 2, 'monthly')).toBe('2026-02-28')
    expect(dateDuTour('2026-01-31', 3, 'monthly')).toBe('2026-03-31')
    expect(dateDuTour('2026-01-31', 5, 'monthly')).toBe('2026-05-31')
  })

  it('mensuelle : février d’une année bissextile', () => {
    expect(dateDuTour('2028-01-31', 2, 'monthly')).toBe('2028-02-29')
  })
})
