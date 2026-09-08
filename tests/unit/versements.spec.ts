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
let cleanup: () => void
let T: string
let tour1: string

const PRESIDENT = 'f1000000-0000-4000-8000-000000000001'
const TRESORIER = 'f1000000-0000-4000-8000-000000000002'
const CENSEUR = 'f1000000-0000-4000-8000-000000000003'

/** Le président est bénéficiaire du tour 1 : il occupe la position 1. */
beforeEach(async () => {
  const ctx = createTestDb()
  db = ctx.db
  cleanup = ctx.cleanup

  await createTestUser(db, PRESIDENT, '+2250707001111')
  await createTestUser(db, TRESORIER, '+2250707002222')
  await createTestUser(db, CENSEUR, '+2250707003333')

  T = creerBrouillon(db, PRESIDENT, { name: 'Tontine des tantines', access: 'private' })
  majTontine(db, T, { shareAmount: 25_000, frequency: 'monthly', startDate: '2026-01-15' })

  ajouterMembreGere(db, T, { name: 'Koffi', phone: '+2250707002222', shares: 1 })
  ajouterMembreGere(db, T, { name: 'Fatou', phone: '+2250707003333', shares: 1 })
  ajouterMembreGere(db, T, { name: 'Yao', phone: '+2250707004444', shares: 1 })

  const canal = creerCanal(db, PRESIDENT, { provider: 'wave', msisdn: '+2250707001111', holderName: 'Aya' })
  marquerVerifie(db, canal)
  definirCanaux(db, T, [canal], PRESIDENT)
  publier(db, T)
  demarrerTontine(db, T, PRESIDENT)

  for (const [nom, id, role] of [['Koffi', TRESORIER, 'treasurer'], ['Fatou', CENSEUR, 'auditor']] as const) {
    const gere = db.select().from(memberships).all().find(m => m.managedName === nom)!
    db.update(memberships).set({ userId: id, role }).where(eq(memberships.id, gere.id)).run()
  }

  tour1 = db.select().from(rounds).all().find(r => r.index === 1)!.id
})

afterEach(() => cleanup())

/** Confirme toutes les cotisations du tour, pour un pot complet. */
function potComplet() {
  for (const c of db.select().from(contributions).all().filter(x => x.roundId === tour1)) {
    const declarant = c.membershipId === db.select().from(memberships).all()
      .find(m => m.userId === PRESIDENT)!.id
      ? PRESIDENT
      : TRESORIER
    const decideur = declarant === PRESIDENT ? TRESORIER : PRESIDENT

    const { declarationId } = declarerPaiement(db, c.id, declarant, { amount: 25_000, channel: 'wave' })
    confirmerDeclaration(db, declarationId, decideur)
  }
}

const QUATRE = '1111' // les quatre derniers chiffres du numéro du président

describe('état du pot', () => {
  it('distingue le pot constitué du pot attendu', () => {
    const etat = etatVersement(db, tour1)

    // Afficher l'attendu comme s'il était acquis ferait verser un montant que
    // la tontine n'a pas.
    expect(etat.expected).toBe(100_000)
    expect(etat.collected).toBe(0)
    expect(etat.shortfall).toBe(100_000)
    expect(etat.missing).toHaveLength(4)
  })

  it('se remplit au fil des confirmations', () => {
    potComplet()
    const etat = etatVersement(db, tour1)

    expect(etat.collected).toBe(100_000)
    expect(etat.shortfall).toBe(0)
    expect(etat.missing).toEqual([])
  })

  it('alerte si le numéro du bénéficiaire a changé il y a moins de 48 h', () => {
    db.update(users)
      .set({ phoneChangedAt: new Date(Date.now() - 3_600_000) })
      .where(eq(users.id, PRESIDENT))
      .run()

    // Un numéro changé récemment est le signal d'un détournement par prise de
    // contrôle de compte.
    expect(etatVersement(db, tour1).beneficiary.phoneRecentlyChanged).toBe(true)
  })

  it('n’alerte plus au-delà de 48 h', () => {
    db.update(users)
      .set({ phoneChangedAt: new Date(Date.now() - 50 * 3_600_000) })
      .where(eq(users.id, PRESIDENT))
      .run()

    expect(etatVersement(db, tour1).beneficiary.phoneRecentlyChanged).toBe(false)
  })
})

describe('préparation', () => {
  it('exige les quatre bons chiffres', () => {
    potComplet()

    // Seul garde-fou contre l'envoi au mauvais numéro.
    expect(() => preparerVersement(db, tour1, TRESORIER, {
      beneficiaryPhoneLast4: '9999', acceptIncompletePot: false,
    })).toThrow(expect.objectContaining({ statusCode: 422 }))
  })

  it('prépare un pot complet et passe le tour en attente de versement', () => {
    potComplet()
    const resultat = preparerVersement(db, tour1, TRESORIER, {
      beneficiaryPhoneLast4: QUATRE, acceptIncompletePot: false,
    })

    expect(resultat.amount).toBe(100_000)
    expect(resultat.shortfall).toBe(0)
    expect(db.select().from(rounds).all().find(r => r.id === tour1)!.status).toBe('payout_pending')
  })

  it('refuse un pot incomplet sans décision explicite', () => {
    // Une seule cotisation confirmée : le pot est partiel, pas vide.
    const [premiere] = db.select().from(contributions).all().filter(c => c.roundId === tour1)
    const { declarationId } = declarerPaiement(db, premiere!.id, TRESORIER, { amount: 25_000, channel: 'wave' })
    confirmerDeclaration(db, declarationId, PRESIDENT)

    expect(() => preparerVersement(db, tour1, TRESORIER, {
      beneficiaryPhoneLast4: QUATRE, acceptIncompletePot: false,
    })).toThrow(expect.objectContaining({ statusCode: 403 }))
  })

  it('refuse de préparer un versement sur un pot vide', () => {
    // Ce n'est pas un pot incomplet qu'on assume : c'est un tour où personne
    // n'a cotisé. Le laisser passer produirait un versement à zéro au registre.
    expect(() => preparerVersement(db, tour1, PRESIDENT, {
      beneficiaryPhoneLast4: QUATRE, acceptIncompletePot: true,
    })).toThrow(expect.objectContaining({
      statusCode: 403,
      data: { error: expect.objectContaining({ field: 'collected' }) },
    }))
  })

  it('écrit le montant manquant au registre quand le pot est forcé', () => {
    // Acceptation T19 : le manquant est écrit, pas masqué. Le bénéficiaire
    // touche moins que prévu, et le groupe doit pouvoir le constater.
    const [premiere] = db.select().from(contributions).all().filter(c => c.roundId === tour1)
    const { declarationId } = declarerPaiement(db, premiere!.id, TRESORIER, { amount: 25_000, channel: 'wave' })
    confirmerDeclaration(db, declarationId, PRESIDENT)

    const resultat = preparerVersement(db, tour1, PRESIDENT, {
      beneficiaryPhoneLast4: QUATRE, acceptIncompletePot: true,
    })

    expect(resultat.shortfall).toBe(75_000)

    const ecriture = db.select().from(ledgerEntries).all()
      .find(e => (e.payload as { changement?: string }).changement === 'pot_incomplet_assume')

    expect(ecriture).toBeDefined()
    const payload = ecriture!.payload as { shortfall: number, missing: unknown[] }
    expect(payload.shortfall).toBe(75_000)
    expect(payload.missing).toHaveLength(3)
  })
})

describe('contre-validation au-delà du seuil', () => {
  beforeEach(() => {
    potComplet()
    // Seuil abaissé pour que le pot de 100 000 le dépasse.
    db.update(tontines).set({ counterValidationThreshold: 50_000 }).where(eq(tontines.id, T)).run()
  })

  it('refuse la déclaration directe au-delà du seuil', () => {
    preparerVersement(db, tour1, TRESORIER, { beneficiaryPhoneLast4: QUATRE, acceptIncompletePot: false })

    expect(() => declarerVersement(db, tour1, TRESORIER, { channel: 'wave' })).toThrow(
      expect.objectContaining({ statusCode: 403 }),
    )
  })

  it('refuse la contre-validation par celui qui a préparé', () => {
    preparerVersement(db, tour1, TRESORIER, { beneficiaryPhoneLast4: QUATRE, acceptIncompletePot: false })

    // Deux paires d'yeux : c'est ce qui distingue une erreur rattrapable d'un
    // détournement.
    expect(() => contreValiderVersement(db, tour1, TRESORIER)).toThrow(
      expect.objectContaining({ statusCode: 403 }),
    )
  })

  it('accepte la contre-validation par quelqu’un d’autre, puis la déclaration', () => {
    preparerVersement(db, tour1, TRESORIER, { beneficiaryPhoneLast4: QUATRE, acceptIncompletePot: false })
    contreValiderVersement(db, tour1, CENSEUR)

    expect(() => declarerVersement(db, tour1, TRESORIER, { channel: 'wave' })).not.toThrow()
  })

  it('laisse passer directement sous le seuil', () => {
    db.update(tontines).set({ counterValidationThreshold: 500_000 }).where(eq(tontines.id, T)).run()
    preparerVersement(db, tour1, TRESORIER, { beneficiaryPhoneLast4: QUATRE, acceptIncompletePot: false })

    expect(() => declarerVersement(db, tour1, TRESORIER, { channel: 'wave' })).not.toThrow()
  })
})

describe('accusé de réception — acceptation T19', () => {
  beforeEach(() => {
    potComplet()
    db.update(tontines).set({ counterValidationThreshold: 500_000 }).where(eq(tontines.id, T)).run()
    preparerVersement(db, tour1, TRESORIER, { beneficiaryPhoneLast4: QUATRE, acceptIncompletePot: false })
    declarerVersement(db, tour1, TRESORIER, { channel: 'wave' })
  })

  it('refuse l’accusé par quelqu’un d’autre que le bénéficiaire, avec un 403', () => {
    // Sans cela, la parole du trésorier suffirait à clore un tour : il se
    // délivrerait un quitus à lui-même.
    expect(() => accuserReception(db, tour1, TRESORIER, 100_000)).toThrow(
      expect.objectContaining({ statusCode: 403 }),
    )
    expect(() => accuserReception(db, tour1, CENSEUR, 100_000)).toThrow(
      expect.objectContaining({ statusCode: 403 }),
    )
  })

  it('ne clôt pas le tour tant que l’accusé n’est pas posé', () => {
    expect(db.select().from(rounds).all().find(r => r.id === tour1)!.status).toBe('payout_pending')
  })

  it('clôt le tour au moment de l’accusé du bénéficiaire', () => {
    const resultat = accuserReception(db, tour1, PRESIDENT, 100_000)

    expect(resultat.roundClosed).toBe(true)
    const tour = db.select().from(rounds).all().find(r => r.id === tour1)!
    expect(tour.status).toBe('closed')
    expect(tour.closedAt).not.toBeNull()
  })

  it('consigne l’écart entre le montant déclaré et le montant reçu', () => {
    // Un écart est un signal : il ne bloque pas, il se voit.
    const resultat = accuserReception(db, tour1, PRESIDENT, 95_000)
    expect(resultat.ecart).toBe(-5_000)

    const ecriture = db.select().from(ledgerEntries).all()
      .find(e => e.type === 'payout_acknowledged')!
    expect((ecriture.payload as { ecart: number }).ecart).toBe(-5_000)
  })

  it('refuse un second accusé', () => {
    accuserReception(db, tour1, PRESIDENT, 100_000)

    expect(() => accuserReception(db, tour1, PRESIDENT, 100_000)).toThrow(
      expect.objectContaining({ statusCode: 409 }),
    )
  })
})

describe('contre-validation ouverte au bénéficiaire — docs/data-model.md §2.5', () => {
  /** Fait du porteur de ce compte le bénéficiaire du tour 1. */
  function beneficiaireEst(userId: string) {
    const ms = db.select().from(memberships).all().find(m => m.userId === userId)!
    const part = db.select().from(shares).all().find(s => s.membershipId === ms.id)!
    db.update(rounds).set({ beneficiaryShareId: part.id }).where(eq(rounds.id, tour1)).run()
  }

  /** Retire sa casquette à quelqu'un : le bureau se réduit d'autant. */
  function simpleMembre(userId: string) {
    db.update(memberships).set({ role: 'member' }).where(eq(memberships.userId, userId)).run()
  }

  beforeEach(() => {
    potComplet()
    db.update(tontines).set({ counterValidationThreshold: 50_000 }).where(eq(tontines.id, T)).run()
  })

  it('compte le bénéficiaire du tour parmi les contre-validateurs', () => {
    beneficiaireEst(TRESORIER)
    simpleMembre(CENSEUR)

    const possibles = contreValidateursPossibles(db, tour1, PRESIDENT)

    // Le trésorier n'est pas du bureau au sens du §2.5 ; il est ici parce que
    // c'est lui qui prend la main, donc lui qui perd si le montant est faux.
    expect(possibles).toContain(TRESORIER)
    expect(possibles).not.toContain(PRESIDENT)
  })

  it('laisse le bénéficiaire contre-valider ce qu’il va recevoir', () => {
    beneficiaireEst(TRESORIER)
    simpleMembre(CENSEUR)

    // '2222' : les quatre derniers chiffres du numéro de Koffi, le bénéficiaire.
    preparerVersement(db, tour1, PRESIDENT, { beneficiaryPhoneLast4: '2222', acceptIncompletePot: false })
    const resultat = contreValiderVersement(db, tour1, TRESORIER)

    expect(resultat.status).toBe('counter_validated')
    expect(() => declarerVersement(db, tour1, PRESIDENT, { channel: 'wave' })).not.toThrow()
  })

  it('refuse la contre-validation par le trésorier, qui n’est ni du bureau ni bénéficiaire', () => {
    // Le §2.5 réserve la contre-validation au président et au censeur. Le
    // trésorier prépare, il ne se relit pas.
    preparerVersement(db, tour1, PRESIDENT, { beneficiaryPhoneLast4: QUATRE, acceptIncompletePot: false })

    expect(() => contreValiderVersement(db, tour1, TRESORIER)).toThrow(
      expect.objectContaining({ statusCode: 403 }),
    )
  })

  it('exige toujours la contre-validation tant qu’un second acteur existe', () => {
    preparerVersement(db, tour1, PRESIDENT, { beneficiaryPhoneLast4: QUATRE, acceptIncompletePot: false })

    // Le censeur est là : le seuil garde toute sa force.
    expect(contreValidateursPossibles(db, tour1, PRESIDENT)).toContain(CENSEUR)
    expect(() => declarerVersement(db, tour1, PRESIDENT, { channel: 'wave' })).toThrow(
      expect.objectContaining({ statusCode: 403 }),
    )
  })

  it('passe outre quand personne ne peut contre-valider, et l’inscrit au registre', () => {
    // Le tour où le président est lui-même bénéficiaire d'une tontine qu'il
    // tient seul : plus aucun second acteur. Bloquer là gèlerait le pot.
    simpleMembre(TRESORIER)
    simpleMembre(CENSEUR)
    preparerVersement(db, tour1, PRESIDENT, { beneficiaryPhoneLast4: QUATRE, acceptIncompletePot: false })

    expect(contreValidateursPossibles(db, tour1, PRESIDENT)).toHaveLength(0)
    expect(() => declarerVersement(db, tour1, PRESIDENT, { channel: 'wave' })).not.toThrow()

    const [ecriture] = db.select().from(ledgerEntries).all()
      .filter(e => e.type === 'payout_declared')
    const payload = ecriture!.payload as { contreValidationImpossible?: boolean }

    // Le groupe doit pouvoir lire que ce versement n'a été vu que par une
    // personne. C'est tout ce qu'on peut lui offrir à la place du contrôle.
    expect(payload.contreValidationImpossible).toBe(true)
  })

  it('ne marque rien quand la contre-validation a bien eu lieu', () => {
    preparerVersement(db, tour1, PRESIDENT, { beneficiaryPhoneLast4: QUATRE, acceptIncompletePot: false })
    contreValiderVersement(db, tour1, CENSEUR)
    declarerVersement(db, tour1, PRESIDENT, { channel: 'wave' })

    const [ecriture] = db.select().from(ledgerEntries).all()
      .filter(e => e.type === 'payout_declared')
    expect(ecriture!.payload).not.toHaveProperty('contreValidationImpossible')
  })
})

describe('clôture d’un tour sans accusé — la tontine ne se fige plus', () => {
  beforeEach(() => {
    potComplet()
    db.update(tontines).set({ counterValidationThreshold: 500_000 }).where(eq(tontines.id, T)).run()
  })

  /** Amène le tour 1 jusqu'au versement déclaré. */
  function potEnvoye() {
    preparerVersement(db, tour1, TRESORIER, { beneficiaryPhoneLast4: QUATRE, acceptIncompletePot: false })
    declarerVersement(db, tour1, TRESORIER, { channel: 'wave' })
  }

  it('refuse de clore avant que le pot soit parti', () => {
    preparerVersement(db, tour1, TRESORIER, { beneficiaryPhoneLast4: QUATRE, acceptIncompletePot: false })

    // Clore là ne serait pas une exception, ce serait une perte sèche pour le
    // bénéficiaire : rien reçu, et plus de tour.
    expect(() => cloturerTourSansAccuse(db, tour1, PRESIDENT, 'Il ne répond pas')).toThrow(
      expect.objectContaining({ statusCode: 409 }),
    )
  })

  it('exige un motif', () => {
    potEnvoye()

    expect(() => cloturerTourSansAccuse(db, tour1, PRESIDENT, '')).toThrow(
      expect.objectContaining({ statusCode: 422 }),
    )
  })

  it('clôt le tour et laisse le versement « déclaré »', () => {
    potEnvoye()
    cloturerTourSansAccuse(db, tour1, PRESIDENT, 'Yao a reçu le pot, il n’a pas l’application')

    const [r] = db.select().from(rounds).where(eq(rounds.id, tour1)).all()
    expect(r!.status).toBe('closed')

    // Le versement ne passe **pas** à `acknowledged` : personne n'a accusé
    // réception, et l'écrire serait un faux.
    const [p] = db.select().from(payouts).where(eq(payouts.roundId, tour1)).all()
    expect(p!.status).toBe('declared')
    expect(p!.acknowledgedAt).toBeNull()
  })

  it('inscrit le motif, l’auteur et si l’accusé était seulement possible', () => {
    potEnvoye()
    cloturerTourSansAccuse(db, tour1, PRESIDENT, 'Yao a reçu le pot, il n’a pas l’application')

    const [ecriture] = db.select().from(ledgerEntries).all()
      .filter(e => (e.payload as { changement?: string }).changement === 'cloture_sans_accuse')
    const payload = ecriture!.payload as { motif: string, beneficiairePouvaitAccuser: boolean }

    expect(ecriture!.actorId).toBe(PRESIDENT)
    expect(payload.motif).toContain('l’application')
    // Le président est bénéficiaire du tour 1 et il a un compte : il aurait pu
    // accuser réception. Un bénéficiaire sans compte, non — ce n'est pas la
    // même histoire, et le registre doit permettre de les distinguer.
    expect(payload.beneficiairePouvaitAccuser).toBe(true)
  })

  it('libère le tour suivant, qui restait bloqué derrière', () => {
    potEnvoye()
    cloturerTourSansAccuse(db, tour1, PRESIDENT, 'Reçu de la main à la main')

    // `ouvrirTourSuivant` n'ouvre rien tant qu'un tour est en cours : un tour
    // qui ne peut pas se clore figeait donc la tontine entière.
    const ouverts = ouvrirTourSuivant(db, new Date('2100-01-01T00:00:00Z'))
    expect(ouverts).toBe(1)
  })

  it('refuse un second passage sur un tour déjà clos', () => {
    potEnvoye()
    cloturerTourSansAccuse(db, tour1, PRESIDENT, 'Reçu de la main à la main')

    expect(() => cloturerTourSansAccuse(db, tour1, PRESIDENT, 'Encore')).toThrow(
      expect.objectContaining({ statusCode: 409 }),
    )
  })
})

describe('fin du cycle — une tontine finissait par ne jamais finir', () => {
  /** Clôt tous les tours de la tontine, du premier au dernier. */
  function clotureTousLesTours() {
    const tours = db.select().from(rounds).where(eq(rounds.tontineId, T)).all()
      .sort((a, b) => a.index - b.index)

    for (const tour of tours) {
      db.update(rounds).set({ status: 'collecting' }).where(eq(rounds.id, tour.id)).run()

      for (const c of db.select().from(contributions).all().filter(x => x.roundId === tour.id)) {
        const { declarationId } = declarerPaiement(db, c.id, TRESORIER, { amount: 25_000, channel: 'wave' })
        confirmerDeclaration(db, declarationId, PRESIDENT)
      }

      const beneficiaire = db.select().from(memberships).all()
        .find(m => m.id === db.select().from(shares).all()
          .find(p => p.id === tour.beneficiaryShareId)!.membershipId)!

      const msisdn = db.select().from(users).all().find(u => u.id === beneficiaire.userId)?.phone
        ?? beneficiaire.managedPhone!

      preparerVersement(db, tour.id, TRESORIER, {
        beneficiaryPhoneLast4: msisdn.slice(-4), acceptIncompletePot: false,
      })
      declarerVersement(db, tour.id, TRESORIER, { channel: 'wave' })
      cloturerTourSansAccuse(db, tour.id, PRESIDENT, 'Reçu de la main à la main')
    }
  }

  beforeEach(() => {
    db.update(tontines).set({ counterValidationThreshold: 500_000 }).where(eq(tontines.id, T)).run()
  })

  it('laisse la tontine en cours tant qu’un tour reste ouvert', () => {
    potComplet()
    preparerVersement(db, tour1, TRESORIER, { beneficiaryPhoneLast4: QUATRE, acceptIncompletePot: false })
    declarerVersement(db, tour1, TRESORIER, { channel: 'wave' })
    cloturerTourSansAccuse(db, tour1, PRESIDENT, 'Reçu de la main à la main')

    const [t] = db.select().from(tontines).where(eq(tontines.id, T)).all()
    expect(t!.status).toBe('running')
  })

  it('clôt la tontine quand son dernier tour se ferme', () => {
    clotureTousLesTours()

    // Rien n'empruntait `running → closed` : une tontine allait au bout de ses
    // tours et restait « en cours » pour toujours, sa place toujours comptée au
    // quota d'abonnement du président.
    const [t] = db.select().from(tontines).where(eq(tontines.id, T)).all()
    expect(t!.status).toBe('closed')
  })

  it('inscrit la fin du cycle au registre', () => {
    clotureTousLesTours()

    const ecritures = db.select().from(ledgerEntries).all()
      .filter(e => (e.payload as { changement?: string }).changement === 'cloture_tontine')
    expect(ecritures).toHaveLength(1)
  })

  it('prévient le groupe sans citer un seul montant (règle 21)', () => {
    clotureTousLesTours()

    const envoyees = db.select().from(notifications).all().filter(n => n.type === 'tontine_terminee')
    expect(envoyees.length).toBeGreaterThan(0)
    expect(envoyees.every(n => !/FCFA|\d{4}/.test(n.body))).toBe(true)
  })
})
