import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  accuserReception, cloturerTourSansAccuse, contreValidateursPossibles, contreValiderVersement,
  declarerVersement, etatVersement, preparerVersement,
} from '../../server/services/versements.ts'
import { declarerPaiement } from '../../server/services/declarations.ts'
import { confirmerDeclaration } from '../../server/services/confirmations.ts'
import { ajouterMembreGere } from '../../server/services/membres.ts'
import { creerCanal, marquerVerifie } from '../../server/services/canaux.ts'
import { creerBrouillon, definirCanaux, majTontine, publier } from '../../server/services/tontines.ts'
import { demarrerTontine } from '../../server/services/tours.ts'
import { ouvrirTourSuivant } from '../../server/services/echeances.ts'
import {
  contributions, ledgerEntries, memberships, notifications, payouts, rounds, shares, tontines, users,
} from '../../server/db/schema.ts'
import { createTestDb, createTestUser } from '../helpers/db.ts'
import type { TestDb } from '../helpers/db.ts'

let db: TestDb
let cleanup: () => Promise<void>
let T: string
let tour1: string

const PRESIDENT = 'f1000000-0000-4000-8000-000000000001'
const TRESORIER = 'f1000000-0000-4000-8000-000000000002'
const CENSEUR = 'f1000000-0000-4000-8000-000000000003'

/** Le président est bénéficiaire du tour 1 : il occupe la position 1. */
beforeEach(async () => {
  const ctx = await createTestDb()
  db = ctx.db
  cleanup = ctx.cleanup

  await createTestUser(db, PRESIDENT, '+2250707001111')
  await createTestUser(db, TRESORIER, '+2250707002222')
  await createTestUser(db, CENSEUR, '+2250707003333')

  T = (await creerBrouillon(db, PRESIDENT, { name: 'Tontine des tantines', access: 'private' }))
  await majTontine(db, T, { shareAmount: 25_000, frequency: 'monthly', startDate: '2026-01-15' })

  await ajouterMembreGere(db, T, { name: 'Koffi', phone: '+2250707002222', shares: 1 })
  await ajouterMembreGere(db, T, { name: 'Fatou', phone: '+2250707003333', shares: 1 })
  await ajouterMembreGere(db, T, { name: 'Yao', phone: '+2250707004444', shares: 1 })

  const canal = await creerCanal(db, PRESIDENT, { provider: 'wave', msisdn: '+2250707001111', holderName: 'Aya' })
  await marquerVerifie(db, canal)
  await definirCanaux(db, T, [canal], PRESIDENT)
  await publier(db, T)
  await demarrerTontine(db, T, PRESIDENT)

  for (const [nom, id, role] of [['Koffi', TRESORIER, 'treasurer'], ['Fatou', CENSEUR, 'auditor']] as const) {
    const gere = (await db.select().from(memberships)).find(m => m.managedName === nom)!
    await db.update(memberships).set({ userId: id, role }).where(eq(memberships.id, gere.id))
  }

  tour1 = (await db.select().from(rounds)).find(r => r.index === 1)!.id
})

afterEach(() => cleanup())

/** Confirme toutes les cotisations du tour, pour un pot complet. */
async function potComplet() {
  for (const c of (await db.select().from(contributions)).filter(x => x.roundId === tour1)) {
    const declarant = c.membershipId === (await db.select().from(memberships))
      .find(m => m.userId === PRESIDENT)!.id
      ? PRESIDENT
      : TRESORIER
    const decideur = declarant === PRESIDENT ? TRESORIER : PRESIDENT

    const { declarationId } = await declarerPaiement(db, c.id, declarant, { amount: 25_000, channel: 'wave' })
    await confirmerDeclaration(db, declarationId, decideur)
  }
}

const QUATRE = '1111' // les quatre derniers chiffres du numéro du président

describe('état du pot', () => {
  it('distingue le pot constitué du pot attendu', async () => {
    const etat = await etatVersement(db, tour1)

    // Afficher l'attendu comme s'il était acquis ferait verser un montant que
    // la tontine n'a pas.
    expect(etat.expected).toBe(100_000)
    expect(etat.collected).toBe(0)
    expect(etat.shortfall).toBe(100_000)
    expect(etat.missing).toHaveLength(4)
  })

  it('se remplit au fil des confirmations', async () => {
    await potComplet()
    const etat = await etatVersement(db, tour1)

    expect(etat.collected).toBe(100_000)
    expect(etat.shortfall).toBe(0)
    expect(etat.missing).toEqual([])
  })

  it('alerte si le numéro du bénéficiaire a changé il y a moins de 48 h', async () => {
    await db.update(users)
      .set({ phoneChangedAt: new Date(Date.now() - 3_600_000) })
      .where(eq(users.id, PRESIDENT))

    // Un numéro changé récemment est le signal d'un détournement par prise de
    // contrôle de compte.
    expect((await etatVersement(db, tour1)).beneficiary.phoneRecentlyChanged).toBe(true)
  })

  it('n’alerte plus au-delà de 48 h', async () => {
    await db.update(users)
      .set({ phoneChangedAt: new Date(Date.now() - 50 * 3_600_000) })
      .where(eq(users.id, PRESIDENT))

    expect((await etatVersement(db, tour1)).beneficiary.phoneRecentlyChanged).toBe(false)
  })
})

describe('préparation', () => {
  it('exige les quatre bons chiffres', async () => {
    await potComplet()

    // Seul garde-fou contre l'envoi au mauvais numéro.
    await expect(preparerVersement(db, tour1, TRESORIER, {
      beneficiaryPhoneLast4: '9999', acceptIncompletePot: false,
    })).rejects.toThrow(expect.objectContaining({ statusCode: 422 }))
  })

  it('prépare un pot complet et passe le tour en attente de versement', async () => {
    await potComplet()
    const resultat = await preparerVersement(db, tour1, TRESORIER, {
      beneficiaryPhoneLast4: QUATRE, acceptIncompletePot: false,
    })

    expect(resultat.amount).toBe(100_000)
    expect(resultat.shortfall).toBe(0)
    expect((await db.select().from(rounds)).find(r => r.id === tour1)!.status).toBe('payout_pending')
  })

  it('refuse un pot incomplet sans décision explicite', async () => {
    // Une seule cotisation confirmée : le pot est partiel, pas vide.
    const [premiere] = (await db.select().from(contributions)).filter(c => c.roundId === tour1)
    const { declarationId } = await declarerPaiement(db, premiere!.id, TRESORIER, { amount: 25_000, channel: 'wave' })
    await confirmerDeclaration(db, declarationId, PRESIDENT)

    await expect(preparerVersement(db, tour1, TRESORIER, {
      beneficiaryPhoneLast4: QUATRE, acceptIncompletePot: false,
    })).rejects.toThrow(expect.objectContaining({ statusCode: 403 }))
  })

  it('refuse de préparer un versement sur un pot vide', async () => {
    // Ce n'est pas un pot incomplet qu'on assume : c'est un tour où personne
    // n'a cotisé. Le laisser passer produirait un versement à zéro au registre.
    await expect(preparerVersement(db, tour1, PRESIDENT, {
      beneficiaryPhoneLast4: QUATRE, acceptIncompletePot: true,
    })).rejects.toThrow(expect.objectContaining({
      statusCode: 403,
      data: { error: expect.objectContaining({ field: 'collected' }) },
    }))
  })

  it('écrit le montant manquant au registre quand le pot est forcé', async () => {
    // Acceptation T19 : le manquant est écrit, pas masqué. Le bénéficiaire
    // touche moins que prévu, et le groupe doit pouvoir le constater.
    const [premiere] = (await db.select().from(contributions)).filter(c => c.roundId === tour1)
    const { declarationId } = await declarerPaiement(db, premiere!.id, TRESORIER, { amount: 25_000, channel: 'wave' })
    await confirmerDeclaration(db, declarationId, PRESIDENT)

    const resultat = await preparerVersement(db, tour1, PRESIDENT, {
      beneficiaryPhoneLast4: QUATRE, acceptIncompletePot: true,
    })

    expect(resultat.shortfall).toBe(75_000)

    const ecriture = (await db.select().from(ledgerEntries))
      .find(e => (e.payload as { changement?: string }).changement === 'pot_incomplet_assume')

    expect(ecriture).toBeDefined()
    const payload = ecriture!.payload as { shortfall: number, missing: unknown[] }
    expect(payload.shortfall).toBe(75_000)
    expect(payload.missing).toHaveLength(3)
  })
})

describe('contre-validation au-delà du seuil', () => {
  beforeEach(async () => {
    await potComplet()
    // Seuil abaissé pour que le pot de 100 000 le dépasse.
    await db.update(tontines).set({ counterValidationThreshold: 50_000 }).where(eq(tontines.id, T))
  })

  it('refuse la déclaration directe au-delà du seuil', async () => {
    await preparerVersement(db, tour1, TRESORIER, { beneficiaryPhoneLast4: QUATRE, acceptIncompletePot: false })

    await expect(declarerVersement(db, tour1, TRESORIER, { channel: 'wave' })).rejects.toThrow(
      expect.objectContaining({ statusCode: 403 }),
    )
  })

  it('refuse la contre-validation par celui qui a préparé', async () => {
    await preparerVersement(db, tour1, TRESORIER, { beneficiaryPhoneLast4: QUATRE, acceptIncompletePot: false })

    // Deux paires d'yeux : c'est ce qui distingue une erreur rattrapable d'un
    // détournement.
    await expect(contreValiderVersement(db, tour1, TRESORIER)).rejects.toThrow(
      expect.objectContaining({ statusCode: 403 }),
    )
  })

  it('accepte la contre-validation par quelqu’un d’autre, puis la déclaration', async () => {
    await preparerVersement(db, tour1, TRESORIER, { beneficiaryPhoneLast4: QUATRE, acceptIncompletePot: false })
    await contreValiderVersement(db, tour1, CENSEUR)

    await declarerVersement(db, tour1, TRESORIER, { channel: 'wave' })
  })

  it('laisse passer directement sous le seuil', async () => {
    await db.update(tontines).set({ counterValidationThreshold: 500_000 }).where(eq(tontines.id, T))
    await preparerVersement(db, tour1, TRESORIER, { beneficiaryPhoneLast4: QUATRE, acceptIncompletePot: false })

    await declarerVersement(db, tour1, TRESORIER, { channel: 'wave' })
  })
})

describe('accusé de réception — acceptation T19', () => {
  beforeEach(async () => {
    await potComplet()
    await db.update(tontines).set({ counterValidationThreshold: 500_000 }).where(eq(tontines.id, T))
    await preparerVersement(db, tour1, TRESORIER, { beneficiaryPhoneLast4: QUATRE, acceptIncompletePot: false })
    await declarerVersement(db, tour1, TRESORIER, { channel: 'wave' })
  })

  it('refuse l’accusé par quelqu’un d’autre que le bénéficiaire, avec un 403', async () => {
    // Sans cela, la parole du trésorier suffirait à clore un tour : il se
    // délivrerait un quitus à lui-même.
    await expect(accuserReception(db, tour1, TRESORIER, 100_000)).rejects.toThrow(
      expect.objectContaining({ statusCode: 403 }),
    )
    await expect(accuserReception(db, tour1, CENSEUR, 100_000)).rejects.toThrow(
      expect.objectContaining({ statusCode: 403 }),
    )
  })

  it('ne clôt pas le tour tant que l’accusé n’est pas posé', async () => {
    expect((await db.select().from(rounds)).find(r => r.id === tour1)!.status).toBe('payout_pending')
  })

  it('clôt le tour au moment de l’accusé du bénéficiaire', async () => {
    const resultat = await accuserReception(db, tour1, PRESIDENT, 100_000)

    expect(resultat.roundClosed).toBe(true)
    const tour = (await db.select().from(rounds)).find(r => r.id === tour1)!
    expect(tour.status).toBe('closed')
    expect(tour.closedAt).not.toBeNull()
  })

  it('consigne l’écart entre le montant déclaré et le montant reçu', async () => {
    // Un écart est un signal : il ne bloque pas, il se voit.
    const resultat = await accuserReception(db, tour1, PRESIDENT, 95_000)
    expect(resultat.ecart).toBe(-5_000)

    const ecriture = (await db.select().from(ledgerEntries))
      .find(e => e.type === 'payout_acknowledged')!
    expect((ecriture.payload as { ecart: number }).ecart).toBe(-5_000)
  })

  it('refuse un second accusé', async () => {
    await accuserReception(db, tour1, PRESIDENT, 100_000)

    await expect(accuserReception(db, tour1, PRESIDENT, 100_000)).rejects.toThrow(
      expect.objectContaining({ statusCode: 409 }),
    )
  })
})

describe('contre-validation ouverte au bénéficiaire — docs/data-model.md §2.5', () => {
  /** Fait du porteur de ce compte le bénéficiaire du tour 1. */
  async function beneficiaireEst(userId: string) {
    const ms = (await db.select().from(memberships)).find(m => m.userId === userId)!
    const part = (await db.select().from(shares)).find(s => s.membershipId === ms.id)!
    await db.update(rounds).set({ beneficiaryShareId: part.id }).where(eq(rounds.id, tour1))
  }

  /** Retire sa casquette à quelqu'un : le bureau se réduit d'autant. */
  async function simpleMembre(userId: string) {
    await db.update(memberships).set({ role: 'member' }).where(eq(memberships.userId, userId))
  }

  beforeEach(async () => {
    await potComplet()
    await db.update(tontines).set({ counterValidationThreshold: 50_000 }).where(eq(tontines.id, T))
  })

  it('compte le bénéficiaire du tour parmi les contre-validateurs', async () => {
    await beneficiaireEst(TRESORIER)
    await simpleMembre(CENSEUR)

    const possibles = await contreValidateursPossibles(db, tour1, PRESIDENT)

    // Le trésorier n'est pas du bureau au sens du §2.5 ; il est ici parce que
    // c'est lui qui prend la main, donc lui qui perd si le montant est faux.
    expect(possibles).toContain(TRESORIER)
    expect(possibles).not.toContain(PRESIDENT)
  })

  it('laisse le bénéficiaire contre-valider ce qu’il va recevoir', async () => {
    await beneficiaireEst(TRESORIER)
    await simpleMembre(CENSEUR)

    // '2222' : les quatre derniers chiffres du numéro de Koffi, le bénéficiaire.
    await preparerVersement(db, tour1, PRESIDENT, { beneficiaryPhoneLast4: '2222', acceptIncompletePot: false })
    const resultat = await contreValiderVersement(db, tour1, TRESORIER)

    expect(resultat.status).toBe('counter_validated')
    await declarerVersement(db, tour1, PRESIDENT, { channel: 'wave' })
  })

  it('refuse la contre-validation par le trésorier, qui n’est ni du bureau ni bénéficiaire', async () => {
    // Le §2.5 réserve la contre-validation au président et au censeur. Le
    // trésorier prépare, il ne se relit pas.
    await preparerVersement(db, tour1, PRESIDENT, { beneficiaryPhoneLast4: QUATRE, acceptIncompletePot: false })

    await expect(contreValiderVersement(db, tour1, TRESORIER)).rejects.toThrow(
      expect.objectContaining({ statusCode: 403 }),
    )
  })

  it('exige toujours la contre-validation tant qu’un second acteur existe', async () => {
    await preparerVersement(db, tour1, PRESIDENT, { beneficiaryPhoneLast4: QUATRE, acceptIncompletePot: false })

    // Le censeur est là : le seuil garde toute sa force.
    expect(await contreValidateursPossibles(db, tour1, PRESIDENT)).toContain(CENSEUR)
    await expect(declarerVersement(db, tour1, PRESIDENT, { channel: 'wave' })).rejects.toThrow(
      expect.objectContaining({ statusCode: 403 }),
    )
  })

  it('passe outre quand personne ne peut contre-valider, et l’inscrit au registre', async () => {
    // Le tour où le président est lui-même bénéficiaire d'une tontine qu'il
    // tient seul : plus aucun second acteur. Bloquer là gèlerait le pot.
    await simpleMembre(TRESORIER)
    await simpleMembre(CENSEUR)
    await preparerVersement(db, tour1, PRESIDENT, { beneficiaryPhoneLast4: QUATRE, acceptIncompletePot: false })

    expect(await contreValidateursPossibles(db, tour1, PRESIDENT)).toHaveLength(0)
    await declarerVersement(db, tour1, PRESIDENT, { channel: 'wave' })

    const [ecriture] = (await db.select().from(ledgerEntries))
      .filter(e => e.type === 'payout_declared')
    const payload = ecriture!.payload as { contreValidationImpossible?: boolean }

    // Le groupe doit pouvoir lire que ce versement n'a été vu que par une
    // personne. C'est tout ce qu'on peut lui offrir à la place du contrôle.
    expect(payload.contreValidationImpossible).toBe(true)
  })

  it('ne marque rien quand la contre-validation a bien eu lieu', async () => {
    await preparerVersement(db, tour1, PRESIDENT, { beneficiaryPhoneLast4: QUATRE, acceptIncompletePot: false })
    await contreValiderVersement(db, tour1, CENSEUR)
    await declarerVersement(db, tour1, PRESIDENT, { channel: 'wave' })

    const [ecriture] = (await db.select().from(ledgerEntries))
      .filter(e => e.type === 'payout_declared')
    expect(ecriture!.payload).not.toHaveProperty('contreValidationImpossible')
  })
})

describe('clôture d’un tour sans accusé — la tontine ne se fige plus', () => {
  beforeEach(async () => {
    await potComplet()
    await db.update(tontines).set({ counterValidationThreshold: 500_000 }).where(eq(tontines.id, T))
  })

  /** Amène le tour 1 jusqu'au versement déclaré. */
  async function potEnvoye() {
    await preparerVersement(db, tour1, TRESORIER, { beneficiaryPhoneLast4: QUATRE, acceptIncompletePot: false })
    await declarerVersement(db, tour1, TRESORIER, { channel: 'wave' })
  }

  it('refuse de clore avant que le pot soit parti', async () => {
    await preparerVersement(db, tour1, TRESORIER, { beneficiaryPhoneLast4: QUATRE, acceptIncompletePot: false })

    // Clore là ne serait pas une exception, ce serait une perte sèche pour le
    // bénéficiaire : rien reçu, et plus de tour.
    await expect(cloturerTourSansAccuse(db, tour1, PRESIDENT, 'Il ne répond pas')).rejects.toThrow(
      expect.objectContaining({ statusCode: 409 }),
    )
  })

  it('exige un motif', async () => {
    await potEnvoye()

    await expect(cloturerTourSansAccuse(db, tour1, PRESIDENT, '')).rejects.toThrow(
      expect.objectContaining({ statusCode: 422 }),
    )
  })

  it('clôt le tour et laisse le versement « déclaré »', async () => {
    await potEnvoye()
    await cloturerTourSansAccuse(db, tour1, PRESIDENT, 'Yao a reçu le pot, il n’a pas l’application')

    const [r] = await db.select().from(rounds).where(eq(rounds.id, tour1))
    expect(r!.status).toBe('closed')

    // Le versement ne passe **pas** à `acknowledged` : personne n'a accusé
    // réception, et l'écrire serait un faux.
    const [p] = await db.select().from(payouts).where(eq(payouts.roundId, tour1))
    expect(p!.status).toBe('declared')
    expect(p!.acknowledgedAt).toBeNull()
  })

  it('inscrit le motif, l’auteur et si l’accusé était seulement possible', async () => {
    await potEnvoye()
    await cloturerTourSansAccuse(db, tour1, PRESIDENT, 'Yao a reçu le pot, il n’a pas l’application')

    const [ecriture] = (await db.select().from(ledgerEntries))
      .filter(e => (e.payload as { changement?: string }).changement === 'cloture_sans_accuse')
    const payload = ecriture!.payload as { motif: string, beneficiairePouvaitAccuser: boolean }

    expect(ecriture!.actorId).toBe(PRESIDENT)
    expect(payload.motif).toContain('l’application')
    // Le président est bénéficiaire du tour 1 et il a un compte : il aurait pu
    // accuser réception. Un bénéficiaire sans compte, non — ce n'est pas la
    // même histoire, et le registre doit permettre de les distinguer.
    expect(payload.beneficiairePouvaitAccuser).toBe(true)
  })

  it('libère le tour suivant, qui restait bloqué derrière', async () => {
    await potEnvoye()
    await cloturerTourSansAccuse(db, tour1, PRESIDENT, 'Reçu de la main à la main')

    // `ouvrirTourSuivant` n'ouvre rien tant qu'un tour est en cours : un tour
    // qui ne peut pas se clore figeait donc la tontine entière.
    const ouverts = await ouvrirTourSuivant(db, new Date('2100-01-01T00:00:00Z'))
    expect(ouverts).toBe(1)
  })

  it('refuse un second passage sur un tour déjà clos', async () => {
    await potEnvoye()
    await cloturerTourSansAccuse(db, tour1, PRESIDENT, 'Reçu de la main à la main')

    await expect(cloturerTourSansAccuse(db, tour1, PRESIDENT, 'Encore')).rejects.toThrow(
      expect.objectContaining({ statusCode: 409 }),
    )
  })
})

describe('fin du cycle — une tontine finissait par ne jamais finir', () => {
  /** Clôt tous les tours de la tontine, du premier au dernier. */
  async function clotureTousLesTours() {
    const tours = (await db.select().from(rounds).where(eq(rounds.tontineId, T)))
      .sort((a, b) => a.index - b.index)

    for (const tour of tours) {
      await db.update(rounds).set({ status: 'collecting' }).where(eq(rounds.id, tour.id))

      for (const c of (await db.select().from(contributions)).filter(x => x.roundId === tour.id)) {
        const { declarationId } = await declarerPaiement(db, c.id, TRESORIER, { amount: 25_000, channel: 'wave' })
        await confirmerDeclaration(db, declarationId, PRESIDENT)
      }

      const beneficiaire = (await db.select().from(memberships))
        .find(async m => m.id === (await db.select().from(shares))
          .find(p => p.id === tour.beneficiaryShareId)!.membershipId)!

      const msisdn = (await db.select().from(users)).find(u => u.id === beneficiaire.userId)?.phone
        ?? beneficiaire.managedPhone!

      await preparerVersement(db, tour.id, TRESORIER, {
        beneficiaryPhoneLast4: msisdn.slice(-4), acceptIncompletePot: false,
      })
      await declarerVersement(db, tour.id, TRESORIER, { channel: 'wave' })
      await cloturerTourSansAccuse(db, tour.id, PRESIDENT, 'Reçu de la main à la main')
    }
  }

  beforeEach(async () => {
    await db.update(tontines).set({ counterValidationThreshold: 500_000 }).where(eq(tontines.id, T))
  })

  it('laisse la tontine en cours tant qu’un tour reste ouvert', async () => {
    await potComplet()
    await preparerVersement(db, tour1, TRESORIER, { beneficiaryPhoneLast4: QUATRE, acceptIncompletePot: false })
    await declarerVersement(db, tour1, TRESORIER, { channel: 'wave' })
    await cloturerTourSansAccuse(db, tour1, PRESIDENT, 'Reçu de la main à la main')

    const [t] = await db.select().from(tontines).where(eq(tontines.id, T))
    expect(t!.status).toBe('running')
  })

  it('clôt la tontine quand son dernier tour se ferme', async () => {
    await clotureTousLesTours()

    // Rien n'empruntait `running → closed` : une tontine allait au bout de ses
    // tours et restait « en cours » pour toujours, sa place toujours comptée au
    // quota d'abonnement du président.
    const [t] = await db.select().from(tontines).where(eq(tontines.id, T))
    expect(t!.status).toBe('closed')
  })

  it('inscrit la fin du cycle au registre', async () => {
    await clotureTousLesTours()

    const ecritures = (await db.select().from(ledgerEntries))
      .filter(e => (e.payload as { changement?: string }).changement === 'cloture_tontine')
    expect(ecritures).toHaveLength(1)
  })

  it('prévient le groupe sans citer un seul montant (règle 21)', async () => {
    await clotureTousLesTours()

    const envoyees = (await db.select().from(notifications)).filter(n => n.type === 'tontine_terminee')
    expect(envoyees.length).toBeGreaterThan(0)
    expect(envoyees.every(n => !/FCFA|\d{4}/.test(n.body))).toBe(true)
  })
})
