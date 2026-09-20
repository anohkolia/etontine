import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  ajouterMembreGere, definirRotation, membresDe, resteDu, retirerMembre, rotationDe,
} from '../../server/services/membres.ts'
import { melangerAvecGraine, verifierTirage } from '../../server/services/rotation.ts'
import { dateDuTour, demarrerTontine } from '../../server/services/tours.ts'
import { creerCanal } from '../../server/services/canaux.ts'
import { creerBrouillon, definirCanaux, majTontine, publier } from '../../server/services/tontines.ts'
import { contributions, ledgerEntries, memberships, rounds, tontines } from '../../server/db/schema.ts'
import { createTestDb, createTestUser } from '../helpers/db.ts'
import type { TestDb } from '../helpers/db.ts'

let db: TestDb
let cleanup: () => Promise<void>
let T: string

const PRESIDENT = 'e0000000-0000-4000-8000-000000000001'

beforeEach(async () => {
  const ctx = await createTestDb()
  db = ctx.db
  cleanup = ctx.cleanup

  await createTestUser(db, PRESIDENT, '+2250707000001')
  T = (await creerBrouillon(db, PRESIDENT, { name: 'Tontine des tantines', access: 'private' }))
  await majTontine(db, T, { shareAmount: 25_000, frequency: 'monthly', startDate: '2026-01-15' })

  // Le président est déjà adhérent, sans part : il préside, il ne cotise pas.

  // Un canal vérifié, puis publication : `demarrerTontine` exige `open`, et
  // sauter la publication reviendrait à tester une transition qui n'existe pas.
  const canal = await creerCanal(db, PRESIDENT, {
    provider: 'wave', msisdn: '+2250707000001', holderName: 'Aya Koné',
  })
  await definirCanaux(db, T, [canal], PRESIDENT)
  await publier(db, T)
})

afterEach(() => cleanup())

/** Six cotisants, dont Yao Brou à **deux parts** — sept parts au total. Le président n'en a pas. */
async function groupeAvecDoublePart() {
  await ajouterMembreGere(db, T, { name: 'Koffi N’Guessan', phone: '+2250707000002', shares: 1 })
  await ajouterMembreGere(db, T, { name: 'Fatou Diarra', phone: '+2250707000003', shares: 1 })
  const yao = await ajouterMembreGere(db, T, { name: 'Yao Brou', phone: '+2250707000004', shares: 2 })
  await ajouterMembreGere(db, T, { name: 'Mariam Touré', phone: '+2250707000005', shares: 1 })
  await ajouterMembreGere(db, T, { name: 'Ibrahim Sanogo', phone: '+2250707000006', shares: 1 })
  await ajouterMembreGere(db, T, { name: 'Aminata Coulibaly', phone: '+2250707000007', shares: 1 })
  return yao
}

describe('double part — le test central du modèle (T11)', () => {
  it('occupe deux positions distinctes dans la rotation', async () => {
    const yao = await groupeAvecDoublePart()
    const parts = (await rotationDe(db, T)).filter(p => p.membershipId === yao)

    expect(parts).toHaveLength(2)
    expect(parts[0]!.rotationPosition).not.toBe(parts[1]!.rotationPosition)
  })

  it('apparaît deux fois dans la rotation, et une seule dans la liste des membres', async () => {
    const yao = await groupeAvecDoublePart()

    // La rotation raisonne sur les parts…
    expect((await rotationDe(db, T)).filter(p => p.membershipId === yao)).toHaveLength(2)

    // …et la liste des membres sur les adhésions, en indiquant les deux positions.
    const membres = await membresDe(db, T)
    const fiche = membres.find(m => m.id === yao)
    expect(fiche!.shares).toBe(2)
    expect(fiche!.positions).toHaveLength(2)
    expect(membres.filter(m => m.id === yao)).toHaveLength(1)
  })

  it('génère deux cotisations par tour', async () => {
    const yao = await groupeAvecDoublePart()
    const resultat = await demarrerTontine(db, T, PRESIDENT)

    // Sept parts → sept tours, et sept cotisations par tour.
    expect(resultat.rounds).toBe(7)
    expect(resultat.contributions).toBe(49)

    const tours = await db.select().from(rounds).where(eq(rounds.tontineId, T))
    for (const tour of tours) {
      const siennes = (await db
        .select()
        .from(contributions)
        .where(eq(contributions.roundId, tour.id)))
        .filter(c => c.membershipId === yao)

      expect(siennes, `tour ${tour.index}`).toHaveLength(2)
    }
  })

  it('prend la main deux fois sur le cycle', async () => {
    const yao = await groupeAvecDoublePart()
    await demarrerTontine(db, T, PRESIDENT)

    const sesParts = new Set(
      (await rotationDe(db, T)).filter(p => p.membershipId === yao).map(p => p.shareId),
    )
    const sesTours = (await db
      .select()
      .from(rounds)
      .where(eq(rounds.tontineId, T)))
      .filter(r => sesParts.has(r.beneficiaryShareId))

    expect(sesTours).toHaveLength(2)
  })

  it('cotise aussi le tour où il prend la main', async () => {
    // Usage ivoirien : le bénéficiaire cotise, et le net lui revient au
    // versement. L'exclure fausserait le pot de tout le monde.
    const yao = await groupeAvecDoublePart()
    await demarrerTontine(db, T, PRESIDENT)

    const sesParts = new Set(
      (await rotationDe(db, T)).filter(p => p.membershipId === yao).map(p => p.shareId),
    )
    const sonTour = (await db
      .select()
      .from(rounds)
      .where(eq(rounds.tontineId, T)))
      .find(r => sesParts.has(r.beneficiaryShareId))!

    const cotisations = await db.select().from(contributions).where(eq(contributions.roundId, sonTour.id))
    expect(cotisations.filter(c => c.membershipId === yao)).toHaveLength(2)
    expect(cotisations).toHaveLength(7)
  })

  it('pèse deux parts dans le pot attendu', async () => {
    await groupeAvecDoublePart()
    const { expectedAmount } = await demarrerTontine(db, T, PRESIDENT)

    // 7 parts × 25 000 = 175 000, et non 6 membres × 25 000.
    expect(expectedAmount).toBe(175_000)
  })
})

describe('tirage au sort — preuve anti-soupçon', () => {
  beforeEach(async () => await groupeAvecDoublePart())

  it('écrit la graine et le résultat au registre', async () => {
    const resultat = await definirRotation(db, T, PRESIDENT, { mode: 'draw' })

    const [ecriture] = await db.select().from(ledgerEntries).where(eq(ledgerEntries.type, 'rotation_changed'))
    expect(ecriture).toBeDefined()

    const payload = ecriture!.payload as { seed: string, order: string[], mode: string }
    expect(payload.mode).toBe('draw')
    expect(payload.seed).toBe(resultat.seed)
    expect(payload.order).toEqual(resultat.order)
  })

  it('permet de rejouer le tirage et de retrouver le même ordre', async () => {
    await definirRotation(db, T, PRESIDENT, { mode: 'draw' })
    const [ecriture] = await db.select().from(ledgerEntries).where(eq(ledgerEntries.type, 'rotation_changed'))
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

  it('attribue des positions consécutives à partir de 1', async () => {
    await definirRotation(db, T, PRESIDENT, { mode: 'draw' })
    const positions = (await rotationDe(db, T)).map(p => p.rotationPosition)
    expect(positions).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('refuse un ordre fixe incomplet', async () => {
    const parts = (await rotationDe(db, T)).map(p => p.shareId)
    await expect(definirRotation(db, T, PRESIDENT, { mode: 'fixed', order: parts.slice(0, 3) })).rejects
      .toThrow(expect.objectContaining({ statusCode: 422 }))
  })
})

describe('ordre figé après le démarrage', () => {
  it('refuse de modifier l’ordre une fois la tontine lancée', async () => {
    await groupeAvecDoublePart()
    await demarrerTontine(db, T, PRESIDENT)

    // Acceptation T11 : après `start`, l'ordre n'est plus modifiable sans
    // contre-validation. Le déplacer en cours de cycle avantagerait quelqu'un
    // au détriment d'un autre, sur un pot déjà partiellement cotisé.
    await expect(definirRotation(db, T, PRESIDENT, { mode: 'draw' })).rejects.toThrow(
      expect.objectContaining({ statusCode: 403 }),
    )
  })

  it('pose la date de gel au démarrage', async () => {
    await groupeAvecDoublePart()
    await demarrerTontine(db, T, PRESIDENT)

    const [t] = await db.select().from(tontines).where(eq(tontines.id, T))
    expect(t!.rotationFrozenAt).not.toBeNull()
    expect(t!.status).toBe('running')
  })

  it('refuse de démarrer à moins de trois membres actifs', async () => {
    await ajouterMembreGere(db, T, { name: 'Koffi', phone: '+2250707000002', shares: 1 })
    await expect(demarrerTontine(db, T, PRESIDENT)).rejects.toThrow(
      expect.objectContaining({ statusCode: 403 }),
    )
  })

  it('n’ouvre que le premier tour', async () => {
    await groupeAvecDoublePart()
    await demarrerTontine(db, T, PRESIDENT)

    const tours = await db.select().from(rounds).where(eq(rounds.tontineId, T))
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

describe('sortie d’un membre — « avec calcul de ce qui est dû »', () => {
  it('chiffre ce qu’il laisse derrière lui', async () => {
    const yao = await groupeAvecDoublePart()
    await demarrerTontine(db, T, PRESIDENT)

    // Sept tours, deux parts : quatorze cotisations de 25 000 à son nom, et
    // aucune n'est confirmée.
    expect(await resteDu(db, yao)).toBe(14 * 25_000)
  })

  it('inscrit le montant au registre avec le départ', async () => {
    const yao = await groupeAvecDoublePart()
    await demarrerTontine(db, T, PRESIDENT)

    const resultat = await retirerMembre(db, yao, PRESIDENT)
    expect(resultat.resteDu).toBe(14 * 25_000)

    // Une adhésion qui disparaît sans chiffre, c'est le groupe qui découvre le
    // trou au tour suivant sans trace de qui devait quoi.
    const [ecriture] = (await db.select().from(ledgerEntries)).filter(e => e.type === 'member_left')
    expect((ecriture!.payload as { resteDu: number }).resteDu).toBe(14 * 25_000)
  })

  it('ne compte pas les tours déjà clos', async () => {
    const yao = await groupeAvecDoublePart()
    await demarrerTontine(db, T, PRESIDENT)

    const premier = (await db.select().from(rounds)).find(r => r.index === 1)!
    await db.update(rounds).set({ status: 'closed' }).where(eq(rounds.id, premier.id))

    // Un tour clos est soldé : ce qui n'a pas été versé y est un impayé
    // constaté, pas une dette à venir.
    expect(await resteDu(db, yao)).toBe(12 * 25_000)
  })

  it('sort un membre géré sans casser le registre', async () => {
    const yao = await groupeAvecDoublePart()

    // L'acteur inscrit au registre est celui qui **agit**, pas celui qui part :
    // un membre géré n'a pas de compte, et l'y mettre violait la clé étrangère.
    await retirerMembre(db, yao, PRESIDENT)

    const [ecriture] = (await db.select().from(ledgerEntries)).filter(e => e.type === 'member_left')
    expect(ecriture!.actorId).toBe(PRESIDENT)
  })

  it('refuse de faire sortir le président', async () => {
    await groupeAvecDoublePart()
    const [msPresident] = await db.select().from(memberships).where(eq(memberships.role, 'president'))

    // La tontine perdrait le seul rôle capable de confirmer, de contre-valider
    // et de clore.
    await expect(retirerMembre(db, msPresident!.id, PRESIDENT)).rejects.toThrow(
      expect.objectContaining({ statusCode: 403 }),
    )
  })

  it('expose le reste dû dans la liste des membres', async () => {
    const yao = await groupeAvecDoublePart()
    await demarrerTontine(db, T, PRESIDENT)

    const membre = (await membresDe(db, T)).find(m => m.id === yao)!
    expect(membre.resteDu).toBe(14 * 25_000)
  })
})
