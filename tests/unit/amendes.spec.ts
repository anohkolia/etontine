import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { annulerAmende, appliquerAmende, calculerAmende } from '../../server/services/amendes.ts'
import { avancesDe, enregistrerAvance, solderAvance } from '../../server/services/avances.ts'
import { ajouterMessage, ouvrirContestation, resoudreContestation } from '../../server/services/litiges.ts'
import { appendLedger } from '../../server/services/ledger.ts'
import { ajouterMembreGere } from '../../server/services/membres.ts'
import { creerCanal, marquerVerifie } from '../../server/services/canaux.ts'
import { creerBrouillon, definirCanaux, majTontine, publier } from '../../server/services/tontines.ts'
import { demarrerTontine } from '../../server/services/tours.ts'
import { advances, contributions, ledgerEntries, memberships, penalties, rounds } from '../../server/db/schema.ts'
import { createTestDb, createTestUser } from '../helpers/db.ts'
import type { TestDb } from '../helpers/db.ts'

let db: TestDb
let cleanup: () => void
let T: string

const PRESIDENT = 'b2000000-0000-4000-8000-000000000001'

beforeEach(async () => {
  const ctx = createTestDb()
  db = ctx.db
  cleanup = ctx.cleanup

  await createTestUser(db, PRESIDENT, '+2250707001111')
  T = creerBrouillon(db, PRESIDENT, { name: 'Tontine des tantines', access: 'private' })
  majTontine(db, T, { shareAmount: 25_000, frequency: 'monthly', startDate: '2026-01-15', graceDays: 3 })
  ajouterMembreGere(db, T, { name: 'Koffi', phone: '+2250707002222', shares: 1 })
  ajouterMembreGere(db, T, { name: 'Fatou', phone: '+2250707003333', shares: 1 })

  const canal = creerCanal(db, PRESIDENT, { provider: 'wave', msisdn: '+2250707001111', holderName: 'Aya' })
  marquerVerifie(db, canal)
  definirCanaux(db, T, [canal], PRESIDENT)
  publier(db, T)
  demarrerTontine(db, T, PRESIDENT)
})

afterEach(() => cleanup())

const LE = (jour: string) => new Date(`${jour}T12:00:00Z`)

describe('calcul d’amende — régime « once »', () => {
  const regles = { penaltyAmount: 2_000, penaltyPeriod: 'once' as const, penaltyCap: null, graceDays: 3 }

  it('ne compte rien avant l’échéance', () => {
    expect(calculerAmende(regles, '2026-01-15', LE('2026-01-14'))).toBe(0)
  })

  it('ne compte rien pendant le délai de grâce', () => {
    // La grâce ne sert à rien si l'amende tombe dès l'échéance.
    expect(calculerAmende(regles, '2026-01-15', LE('2026-01-16'))).toBe(0)
    expect(calculerAmende(regles, '2026-01-15', LE('2026-01-18'))).toBe(0)
  })

  it('compte le montant fixe une seule fois, quel que soit le retard', () => {
    expect(calculerAmende(regles, '2026-01-15', LE('2026-01-19'))).toBe(2_000)
    expect(calculerAmende(regles, '2026-01-15', LE('2026-03-19'))).toBe(2_000)
  })

  it('ne compte rien quand la tontine n’a pas d’amende', () => {
    expect(calculerAmende({ ...regles, penaltyAmount: 0 }, '2026-01-15', LE('2026-06-01'))).toBe(0)
  })
})

describe('calcul d’amende — régime « per_day » avec plafond', () => {
  const regles = {
    penaltyAmount: 500, penaltyPeriod: 'per_day' as const, penaltyCap: 5_000, graceDays: 3,
  }

  it('compte les jours après le délai de grâce, pas depuis l’échéance', () => {
    // Échéance le 15, grâce jusqu'au 18 : le 19 est le premier jour compté.
    expect(calculerAmende(regles, '2026-01-15', LE('2026-01-19'))).toBe(500)
    expect(calculerAmende(regles, '2026-01-15', LE('2026-01-22'))).toBe(2_000)
  })

  it('s’arrête au plafond', () => {
    // Sans plafond, une amende journalière dépasse la cotisation en quelques
    // semaines et devient une dette impossible à solder.
    expect(calculerAmende(regles, '2026-01-15', LE('2026-01-28'))).toBe(5_000)
    expect(calculerAmende(regles, '2026-01-15', LE('2026-06-28'))).toBe(5_000)
  })

  it('atteint le plafond exactement au bon jour', () => {
    // 500 × 10 = 5 000 : le dixième jour après la grâce.
    expect(calculerAmende(regles, '2026-01-15', LE('2026-01-27'))).toBe(4_500)
    expect(calculerAmende(regles, '2026-01-15', LE('2026-01-28'))).toBe(5_000)
  })

  it('n’est pas plafonnée si aucun plafond n’est fixé', () => {
    const sansPlafond = { ...regles, penaltyCap: null }
    expect(calculerAmende(sansPlafond, '2026-01-15', LE('2026-02-15'))).toBe(500 * 28)
  })

  it('rend toujours un entier de FCFA', () => {
    for (const jour of ['2026-01-19', '2026-01-23', '2026-02-01']) {
      expect(Number.isInteger(calculerAmende(regles, '2026-01-15', LE(jour)))).toBe(true)
    }
  })
})

describe('application d’une amende — acceptation T22', () => {
  function premiereCotisation() {
    return db.select().from(contributions).all()[0]!
  }

  it('n’est jamais appliquée sans décision explicite', () => {
    // Le calcul dit ce qui serait dû ; il n'écrit rien. Aucune amende
    // n'apparaît tant que le président n'a pas agi.
    calculerAmende({ penaltyAmount: 2_000, penaltyPeriod: 'once', penaltyCap: null, graceDays: 3 },
      '2026-01-15', LE('2026-06-01'))

    expect(db.select().from(penalties).all()).toHaveLength(0)
  })

  it('enregistre l’amende et l’inscrit au registre', () => {
    const cotisation = premiereCotisation()
    const { penaltyId } = appliquerAmende(db, cotisation.id, PRESIDENT, 2_000, 'Retard de 5 jours')

    const [amende] = db.select().from(penalties).where(eq(penalties.id, penaltyId)).all()
    expect(amende!.amount).toBe(2_000)
    expect(amende!.appliedBy).toBe(PRESIDENT)

    const ecritures = db.select().from(ledgerEntries).where(eq(ledgerEntries.type, 'penalty_applied')).all()
    expect(ecritures).toHaveLength(1)
  })

  it('refuse une seconde amende sur la même cotisation', () => {
    const cotisation = premiereCotisation()
    appliquerAmende(db, cotisation.id, PRESIDENT, 2_000)

    expect(() => appliquerAmende(db, cotisation.id, PRESIDENT, 2_000)).toThrow(
      expect.objectContaining({ statusCode: 409 }),
    )
  })

  it('laisse le président appliquer moins que le barème', () => {
    // Le bureau sait faire la différence entre un retard et un abandon.
    const cotisation = premiereCotisation()
    const { amount } = appliquerAmende(db, cotisation.id, PRESIDENT, 500, 'Geste commercial')
    expect(amount).toBe(500)
  })
})

describe('annulation d’une amende — le motif est obligatoire', () => {
  function amendeAppliquee() {
    const cotisation = db.select().from(contributions).all()[0]!
    return appliquerAmende(db, cotisation.id, PRESIDENT, 2_000).penaltyId
  }

  it('refuse une annulation sans motif', () => {
    // Une amende qui disparaît sans explication, c'est ce qui fait dire que
    // « le bureau arrange ses amis ».
    const penaltyId = amendeAppliquee()

    expect(() => annulerAmende(db, penaltyId, PRESIDENT, '')).toThrow(
      expect.objectContaining({ statusCode: 422 }),
    )
    expect(() => annulerAmende(db, penaltyId, PRESIDENT, 'non')).toThrow(
      expect.objectContaining({ statusCode: 422 }),
    )
  })

  it('consigne le motif au registre', () => {
    const penaltyId = amendeAppliquee()
    annulerAmende(db, penaltyId, PRESIDENT, 'Le membre était hospitalisé')

    const [amende] = db.select().from(penalties).where(eq(penalties.id, penaltyId)).all()
    expect(amende!.status).toBe('waived')
    expect(amende!.waiveReason).toBe('Le membre était hospitalisé')

    const ecriture = db.select().from(ledgerEntries).all().find(e => e.type === 'penalty_waived')!
    expect((ecriture.payload as { reason: string }).reason).toBe('Le membre était hospitalisé')
  })

  it('refuse une seconde annulation', () => {
    const penaltyId = amendeAppliquee()
    annulerAmende(db, penaltyId, PRESIDENT, 'Motif suffisant')

    expect(() => annulerAmende(db, penaltyId, PRESIDENT, 'Autre motif')).toThrow(
      expect.objectContaining({ statusCode: 409 }),
    )
  })
})

describe('avances entre membres', () => {
  function deuxMembres() {
    const tous = db.select().from(memberships).where(eq(memberships.tontineId, T)).all()
    return [tous[0]!.id, tous[1]!.id] as const
  }

  it('enregistre l’avance sans toucher aux cotisations', () => {
    const [de, vers] = deuxMembres()
    const tour = db.select().from(rounds).all()[0]!
    const avant = db.select().from(contributions).all().map(c => c.confirmedAmount)

    enregistrerAvance(db, { roundId: tour.id, fromMembershipId: de, toMembershipId: vers, amount: 25_000 })

    // L'avance est une reconnaissance de dette entre deux membres, pas un
    // paiement : elle ne modifie aucune cotisation.
    expect(db.select().from(contributions).all().map(c => c.confirmedAmount)).toEqual(avant)
    expect(db.select().from(advances).all()).toHaveLength(1)
  })

  it('refuse une avance pour soi-même', () => {
    const [de] = deuxMembres()
    const tour = db.select().from(rounds).all()[0]!

    expect(() => enregistrerAvance(db, {
      roundId: tour.id, fromMembershipId: de, toMembershipId: de, amount: 25_000,
    })).toThrow(expect.objectContaining({ statusCode: 422 }))
  })

  it('dit qui a dépanné qui', () => {
    const [de, vers] = deuxMembres()
    const tour = db.select().from(rounds).all()[0]!
    enregistrerAvance(db, { roundId: tour.id, fromMembershipId: de, toMembershipId: vers, amount: 25_000 })

    // « 25 000 F, tour 3 » ne règle aucune dispute : ce qu'on vient chercher
    // dans une avance, ce sont les deux noms.
    const [avance] = avancesDe(db, T)
    expect(avance!.nomPreteur).not.toBe('')
    expect(avance!.nomBeneficiaire).not.toBe('')
    expect(avance!.nomPreteur).not.toBe(avance!.nomBeneficiaire)
  })

  it('se solde une seule fois', () => {
    const [de, vers] = deuxMembres()
    const tour = db.select().from(rounds).all()[0]!
    const { id } = enregistrerAvance(db, {
      roundId: tour.id, fromMembershipId: de, toMembershipId: vers, amount: 25_000,
    })

    expect(solderAvance(db, id).settled).toBe(true)
    expect(() => solderAvance(db, id)).toThrow(expect.objectContaining({ statusCode: 409 }))
  })
})

describe('contestations', () => {
  function uneEcriture() {
    return appendLedger(db, {
      tontineId: T, type: 'contribution_confirmed', actorId: PRESIDENT,
      payload: { amount: 25_000 },
    })
  }

  it('s’ouvre depuis n’importe quelle écriture du registre', () => {
    const ecriture = uneEcriture()
    const { disputeId } = ouvrirContestation(db, ecriture.id, PRESIDENT, 'Je n’ai jamais reçu cette somme')

    expect(disputeId).toBeTruthy()
  })

  it('exige une conclusion écrite pour se clore', () => {
    // Une contestation close sans rien dire laisse le doute là où il était.
    const ecriture = uneEcriture()
    const { disputeId } = ouvrirContestation(db, ecriture.id, PRESIDENT, 'Erreur de montant')

    expect(() => resoudreContestation(db, disputeId, PRESIDENT, '')).toThrow(
      expect.objectContaining({ statusCode: 422 }),
    )
    expect(() => resoudreContestation(db, disputeId, PRESIDENT, 'Corrigé par une écriture d’annulation'))
      .not.toThrow()
  })

  it('n’accepte plus de message une fois close', () => {
    const ecriture = uneEcriture()
    const { disputeId } = ouvrirContestation(db, ecriture.id, PRESIDENT, 'Erreur de montant')
    resoudreContestation(db, disputeId, PRESIDENT, 'Corrigé au registre')

    expect(() => ajouterMessage(db, disputeId, PRESIDENT, 'Encore un mot')).toThrow(
      expect.objectContaining({ statusCode: 409 }),
    )
  })
})
