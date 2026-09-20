import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { annulerAmende, appliquerAmende, calculerAmende } from '../../server/services/amendes.ts'
import { avancesDe, enregistrerAvance, solderAvance } from '../../server/services/avances.ts'
import { ajouterMessage, ouvrirContestation, resoudreContestation } from '../../server/services/litiges.ts'
import { appendLedger } from '../../server/services/ledger.ts'
import { ajouterMembreGere } from '../../server/services/membres.ts'
import { creerCanal } from '../../server/services/canaux.ts'
import { creerBrouillon, definirCanaux, majTontine, publier } from '../../server/services/tontines.ts'
import { demarrerTontine } from '../../server/services/tours.ts'
import { advances, contributions, ledgerEntries, memberships, notifications, penalties, rounds } from '../../server/db/schema.ts'
import { createTestDb, createTestUser } from '../helpers/db.ts'
import type { TestDb } from '../helpers/db.ts'

let db: TestDb
let cleanup: () => Promise<void>
let T: string

const PRESIDENT = 'b2000000-0000-4000-8000-000000000001'

beforeEach(async () => {
  const ctx = await createTestDb()
  db = ctx.db
  cleanup = ctx.cleanup

  await createTestUser(db, PRESIDENT, '+2250707001111')
  T = (await creerBrouillon(db, PRESIDENT, { name: 'Tontine des tantines', access: 'private' }))
  await majTontine(db, T, { shareAmount: 25_000, frequency: 'monthly', startDate: '2026-01-15', graceDays: 3 })
  await ajouterMembreGere(db, T, { name: 'Koffi', phone: '+2250707002222', shares: 1 })
  await ajouterMembreGere(db, T, { name: 'Fatou', phone: '+2250707003333', shares: 1 })

  const canal = await creerCanal(db, PRESIDENT, { provider: 'wave', msisdn: '+2250707001111', holderName: 'Aya' })
  await definirCanaux(db, T, [canal], PRESIDENT)
  await publier(db, T)
  await demarrerTontine(db, T, PRESIDENT)
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
  async function premiereCotisation() {
    return (await db.select().from(contributions))[0]!
  }

  it('n’est jamais appliquée sans décision explicite', async () => {
    // Le calcul dit ce qui serait dû ; il n'écrit rien. Aucune amende
    // n'apparaît tant que le président n'a pas agi.
    calculerAmende({ penaltyAmount: 2_000, penaltyPeriod: 'once', penaltyCap: null, graceDays: 3 },
      '2026-01-15', LE('2026-06-01'))

    expect(await db.select().from(penalties)).toHaveLength(0)
  })

  it('enregistre l’amende et l’inscrit au registre', async () => {
    const cotisation = await premiereCotisation()
    const { penaltyId } = await appliquerAmende(db, cotisation.id, PRESIDENT, 2_000, 'Retard de 5 jours')

    const [amende] = await db.select().from(penalties).where(eq(penalties.id, penaltyId))
    expect(amende!.amount).toBe(2_000)
    expect(amende!.appliedBy).toBe(PRESIDENT)

    const ecritures = await db.select().from(ledgerEntries).where(eq(ledgerEntries.type, 'penalty_applied'))
    expect(ecritures).toHaveLength(1)
  })

  it('refuse une seconde amende sur la même cotisation', async () => {
    const cotisation = await premiereCotisation()
    await appliquerAmende(db, cotisation.id, PRESIDENT, 2_000)

    await expect(appliquerAmende(db, cotisation.id, PRESIDENT, 2_000)).rejects.toThrow(
      expect.objectContaining({ statusCode: 409 }),
    )
  })

  it('laisse le président appliquer moins que le barème', async () => {
    // Le bureau sait faire la différence entre un retard et un abandon.
    const cotisation = await premiereCotisation()
    const { amount } = await appliquerAmende(db, cotisation.id, PRESIDENT, 500, 'Geste commercial')
    expect(amount).toBe(500)
  })
})

describe('annulation d’une amende — le motif est obligatoire', () => {
  async function amendeAppliquee() {
    const cotisation = (await db.select().from(contributions))[0]!
    return (await appliquerAmende(db, cotisation.id, PRESIDENT, 2_000)).penaltyId
  }

  it('refuse une annulation sans motif', async () => {
    // Une amende qui disparaît sans explication, c'est ce qui fait dire que
    // « le bureau arrange ses amis ».
    const penaltyId = await amendeAppliquee()

    await expect(annulerAmende(db, penaltyId, PRESIDENT, '')).rejects.toThrow(
      expect.objectContaining({ statusCode: 422 }),
    )
    await expect(annulerAmende(db, penaltyId, PRESIDENT, 'non')).rejects.toThrow(
      expect.objectContaining({ statusCode: 422 }),
    )
  })

  it('consigne le motif au registre', async () => {
    const penaltyId = await amendeAppliquee()
    await annulerAmende(db, penaltyId, PRESIDENT, 'Le membre était hospitalisé')

    const [amende] = await db.select().from(penalties).where(eq(penalties.id, penaltyId))
    expect(amende!.status).toBe('waived')
    expect(amende!.waiveReason).toBe('Le membre était hospitalisé')

    const ecriture = (await db.select().from(ledgerEntries)).find(e => e.type === 'penalty_waived')!
    expect((ecriture.payload as { reason: string }).reason).toBe('Le membre était hospitalisé')
  })

  it('refuse une seconde annulation', async () => {
    const penaltyId = await amendeAppliquee()
    await annulerAmende(db, penaltyId, PRESIDENT, 'Motif suffisant')

    await expect(annulerAmende(db, penaltyId, PRESIDENT, 'Autre motif')).rejects.toThrow(
      expect.objectContaining({ statusCode: 409 }),
    )
  })
})

describe('avances entre membres', () => {
  async function deuxMembres() {
    const tous = await db.select().from(memberships).where(eq(memberships.tontineId, T))
    return [tous[0]!.id, tous[1]!.id] as const
  }

  it('enregistre l’avance sans toucher aux cotisations', async () => {
    const [de, vers] = await deuxMembres()
    const tour = (await db.select().from(rounds))[0]!
    const avant = (await db.select().from(contributions)).map(c => c.confirmedAmount)

    await enregistrerAvance(db, { roundId: tour.id, fromMembershipId: de, toMembershipId: vers, amount: 25_000 })

    // L'avance est une reconnaissance de dette entre deux membres, pas un
    // paiement : elle ne modifie aucune cotisation.
    expect((await db.select().from(contributions)).map(c => c.confirmedAmount)).toEqual(avant)
    expect(await db.select().from(advances)).toHaveLength(1)
  })

  it('refuse une avance pour soi-même', async () => {
    const [de] = await deuxMembres()
    const tour = (await db.select().from(rounds))[0]!

    await expect(enregistrerAvance(db, {
      roundId: tour.id, fromMembershipId: de, toMembershipId: de, amount: 25_000,
    })).rejects.toThrow(expect.objectContaining({ statusCode: 422 }))
  })

  it('dit qui a dépanné qui', async () => {
    const [de, vers] = await deuxMembres()
    const tour = (await db.select().from(rounds))[0]!
    await enregistrerAvance(db, { roundId: tour.id, fromMembershipId: de, toMembershipId: vers, amount: 25_000 })

    // « 25 000 F, tour 3 » ne règle aucune dispute : ce qu'on vient chercher
    // dans une avance, ce sont les deux noms.
    const [avance] = await avancesDe(db, T)
    expect(avance!.nomPreteur).not.toBe('')
    expect(avance!.nomBeneficiaire).not.toBe('')
    expect(avance!.nomPreteur).not.toBe(avance!.nomBeneficiaire)
  })

  it('se solde une seule fois', async () => {
    const [de, vers] = await deuxMembres()
    const tour = (await db.select().from(rounds))[0]!
    const { id } = await enregistrerAvance(db, {
      roundId: tour.id, fromMembershipId: de, toMembershipId: vers, amount: 25_000,
    })

    expect((await solderAvance(db, id)).settled).toBe(true)
    await expect(solderAvance(db, id)).rejects.toThrow(expect.objectContaining({ statusCode: 409 }))
  })
})

describe('contestations', () => {
  async function uneEcriture() {
    return await appendLedger(db, {
      tontineId: T, type: 'contribution_confirmed', actorId: PRESIDENT,
      payload: { amount: 25_000 },
    })
  }

  it('s’ouvre depuis n’importe quelle écriture du registre', async () => {
    const ecriture = await uneEcriture()
    const { disputeId } = await ouvrirContestation(db, ecriture.id, PRESIDENT, 'Je n’ai jamais reçu cette somme')

    expect(disputeId).toBeTruthy()
  })

  it('exige une conclusion écrite pour se clore', async () => {
    // Une contestation close sans rien dire laisse le doute là où il était.
    const ecriture = await uneEcriture()
    const { disputeId } = await ouvrirContestation(db, ecriture.id, PRESIDENT, 'Erreur de montant')

    await expect(resoudreContestation(db, disputeId, PRESIDENT, '')).rejects.toThrow(
      expect.objectContaining({ statusCode: 422 }),
    )
    await resoudreContestation(db, disputeId, PRESIDENT, 'Corrigé par une écriture d’annulation')
  })

  it('n’accepte plus de message une fois close', async () => {
    const ecriture = await uneEcriture()
    const { disputeId } = await ouvrirContestation(db, ecriture.id, PRESIDENT, 'Erreur de montant')
    await resoudreContestation(db, disputeId, PRESIDENT, 'Corrigé au registre')

    await expect(ajouterMessage(db, disputeId, PRESIDENT, 'Encore un mot')).rejects.toThrow(
      expect.objectContaining({ statusCode: 409 }),
    )
  })

  /**
   * Le fil prévient ceux qu'il concerne. Sans cela, une réponse restait lettre
   * morte : le membre qui avait signalé ne savait pas qu'on lui avait répondu.
   */
  describe('qui est prévenu', () => {
    const MEMBRE = 'b2000000-0000-4000-8000-000000000002'
    const CENSEUR = 'b2000000-0000-4000-8000-000000000003'

    async function bureauAvecCompte() {
      await createTestUser(db, MEMBRE, '+2250707002222')
      await createTestUser(db, CENSEUR, '+2250707003333')
      const koffi = (await db.select().from(memberships)).find(m => m.managedName === 'Koffi')!
      const fatou = (await db.select().from(memberships)).find(m => m.managedName === 'Fatou')!
      await db.update(memberships).set({ userId: MEMBRE }).where(eq(memberships.id, koffi.id))
      await db.update(memberships).set({ userId: CENSEUR, role: 'auditor' }).where(eq(memberships.id, fatou.id))
    }

    async function notifiesDe(type: string) {
      return (await db.select().from(notifications)).filter(n => n.type === type).map(n => n.userId).sort()
    }

    it('une réponse prévient celui qui a signalé et le bureau qui tranche, pas son auteur', async () => {
      await bureauAvecCompte()
      const { disputeId } = await ouvrirContestation(db, (await uneEcriture()).id, MEMBRE, 'Je n’ai jamais reçu cette somme')

      await ajouterMessage(db, disputeId, PRESIDENT, 'On regarde ça')
      // Le membre et le censeur, pas le président qui vient d'écrire.
      expect(await notifiesDe('contestation_reponse')).toEqual([MEMBRE, CENSEUR].sort())

      await db.delete(notifications)
      await ajouterMessage(db, disputeId, MEMBRE, 'Merci, j’attends')
      // Le membre est l'auteur : président et censeur seulement.
      expect(await notifiesDe('contestation_reponse')).toEqual([PRESIDENT, CENSEUR].sort())
    })

    it('la conclusion prévient celui qui a signalé', async () => {
      await bureauAvecCompte()
      const { disputeId } = await ouvrirContestation(db, (await uneEcriture()).id, MEMBRE, 'Je n’ai jamais reçu cette somme')

      await resoudreContestation(db, disputeId, CENSEUR, 'Vérifié : le versement est au registre')
      expect(await notifiesDe('contestation_close')).toEqual([MEMBRE])
    })

    it('n’écrit aucun montant dans ces notifications', async () => {
      await bureauAvecCompte()
      const { disputeId } = await ouvrirContestation(db, (await uneEcriture()).id, MEMBRE, 'Il manque 25 000')
      await ajouterMessage(db, disputeId, PRESIDENT, 'Les 25 000 sont bien là')
      await resoudreContestation(db, disputeId, PRESIDENT, '25 000 confirmés')

      for (const n of await db.select().from(notifications)) {
        expect(n.body).not.toMatch(/\d{2} ?\d{3}/)
      }
    })
  })
})
