import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { confirmerDeclaration, confirmerEnLot, fileDAttente, rejeterDeclaration } from '../../server/services/confirmations.ts'
import { declarerPaiement } from '../../server/services/declarations.ts'
import { ajouterMembreGere } from '../../server/services/membres.ts'
import { creerCanal, marquerVerifie } from '../../server/services/canaux.ts'
import { creerBrouillon, definirCanaux, majTontine, publier } from '../../server/services/tontines.ts'
import { demarrerTontine } from '../../server/services/tours.ts'
import { contributions, ledgerEntries, memberships, notifications, paymentDeclarations } from '../../server/db/schema.ts'
import { createTestDb, createTestUser } from '../helpers/db.ts'
import type { TestDb } from '../helpers/db.ts'

let db: TestDb
let cleanup: () => void
let T: string

const PRESIDENT = 'c1000000-0000-4000-8000-000000000001'
const TRESORIER = 'c1000000-0000-4000-8000-000000000002'
const MEMBRE = 'c1000000-0000-4000-8000-000000000003'

/** Rattache un membre géré à un compte, pour qu'il puisse déclarer et être notifié. */
function rattacher(nom: string, userId: string) {
  const [gere] = db.select().from(memberships).all().filter(m => m.managedName === nom)
  db.update(memberships).set({ userId }).where(eq(memberships.id, gere!.id)).run()
  return gere!.id
}

function cotisationDe(membershipId: string) {
  return db.select().from(contributions).all().find(c => c.membershipId === membershipId)!
}

beforeEach(async () => {
  const ctx = createTestDb()
  db = ctx.db
  cleanup = ctx.cleanup

  await createTestUser(db, PRESIDENT, '+2250707000001')
  await createTestUser(db, TRESORIER, '+2250707000002')
  await createTestUser(db, MEMBRE, '+2250707000003')

  T = creerBrouillon(db, PRESIDENT, { name: 'Tontine des tantines', access: 'private' })
  majTontine(db, T, { shareAmount: 25_000, frequency: 'monthly', startDate: '2026-01-15' })

  ajouterMembreGere(db, T, { name: 'Koffi', phone: '+2250707000002', shares: 1 })
  ajouterMembreGere(db, T, { name: 'Fatou', phone: '+2250707000003', shares: 1 })

  const canal = creerCanal(db, PRESIDENT, { provider: 'wave', msisdn: '+2250707000001', holderName: 'Aya' })
  marquerVerifie(db, canal)
  definirCanaux(db, T, [canal], PRESIDENT)
  publier(db, T)
  demarrerTontine(db, T, PRESIDENT)

  rattacher('Koffi', TRESORIER)
  rattacher('Fatou', MEMBRE)
})

afterEach(() => cleanup())

const ENVOI = { amount: 25_000, channel: 'wave' as const }

describe('séparation déclarant / décideur — acceptation T16', () => {
  it('refuse de confirmer sa propre déclaration, avec un 403', () => {
    const [gere] = db.select().from(memberships).all().filter(m => m.userId === TRESORIER)
    const sienne = cotisationDe(gere!.id)
    const { declarationId } = declarerPaiement(db, sienne.id, TRESORIER, ENVOI)

    // C'est le contrôle qui empêche un organisateur de se déclarer à jour tout
    // seul. Masquer un bouton côté client n'empêcherait rien.
    expect(() => confirmerDeclaration(db, declarationId, TRESORIER)).toThrow(
      expect.objectContaining({ statusCode: 403 }),
    )
  })

  it('accepte la confirmation par quelqu’un d’autre', () => {
    const [gere] = db.select().from(memberships).all().filter(m => m.userId === TRESORIER)
    const { declarationId } = declarerPaiement(db, cotisationDe(gere!.id).id, TRESORIER, ENVOI)

    expect(() => confirmerDeclaration(db, declarationId, PRESIDENT)).not.toThrow()
  })

  it('refuse aussi de rejeter sa propre déclaration', () => {
    const [gere] = db.select().from(memberships).all().filter(m => m.userId === TRESORIER)
    const { declarationId } = declarerPaiement(db, cotisationDe(gere!.id).id, TRESORIER, ENVOI)

    expect(() => rejeterDeclaration(db, declarationId, TRESORIER, 'Envoi introuvable')).toThrow(
      expect.objectContaining({ statusCode: 403 }),
    )
  })
})

describe('confirmation', () => {
  function declarationDuMembre() {
    const [gere] = db.select().from(memberships).all().filter(m => m.userId === MEMBRE)
    return {
      membershipId: gere!.id,
      contribution: cotisationDe(gere!.id),
      ...declarerPaiement(db, cotisationDe(gere!.id).id, MEMBRE, ENVOI),
    }
  }

  it('passe la cotisation à « confirmé » et cumule le montant', () => {
    const { declarationId, contribution } = declarationDuMembre()
    confirmerDeclaration(db, declarationId, TRESORIER)

    const [c] = db.select().from(contributions).where(eq(contributions.id, contribution.id)).all()
    expect(c!.status).toBe('confirmed')
    expect(c!.confirmedAmount).toBe(25_000)
  })

  it('laisse la cotisation ouverte sur un paiement partiel', () => {
    const [gere] = db.select().from(memberships).all().filter(m => m.userId === MEMBRE)
    const cotisation = cotisationDe(gere!.id)
    const { declarationId } = declarerPaiement(db, cotisation.id, MEMBRE, { ...ENVOI, amount: 10_000 })

    confirmerDeclaration(db, declarationId, TRESORIER)

    const [c] = db.select().from(contributions).where(eq(contributions.id, cotisation.id)).all()
    // Le dû n'est pas atteint : la cotisation redevient à verser, pas confirmée.
    expect(c!.confirmedAmount).toBe(10_000)
    expect(c!.status).toBe('due')
  })

  it('génère une écriture au registre', () => {
    const { declarationId } = declarationDuMembre()
    confirmerDeclaration(db, declarationId, TRESORIER)

    const ecritures = db.select().from(ledgerEntries).where(eq(ledgerEntries.type, 'contribution_confirmed')).all()
    expect(ecritures).toHaveLength(1)
    expect(ecritures[0]!.actorId).toBe(TRESORIER)
  })

  it('notifie le membre, sans mentionner de montant', () => {
    const { declarationId } = declarationDuMembre()
    confirmerDeclaration(db, declarationId, TRESORIER)

    const pourLuiF = db.select().from(notifications).all().filter(n => n.userId === MEMBRE)
    expect(pourLuiF).toHaveLength(1)
    // Règle 21 : une notification s'affiche sur un écran verrouillé.
    expect(pourLuiF[0]!.body).not.toMatch(/FCFA|\d{4}/)
  })
})

describe('rejet — le motif est obligatoire', () => {
  function declarationDuMembre() {
    const [gere] = db.select().from(memberships).all().filter(m => m.userId === MEMBRE)
    return declarerPaiement(db, cotisationDe(gere!.id).id, MEMBRE, ENVOI)
  }

  it('refuse un rejet sans motif', () => {
    const { declarationId } = declarationDuMembre()

    // Un rejet sans explication, sur de l'argent qu'on affirme avoir envoyé,
    // est la meilleure façon de casser une tontine.
    expect(() => rejeterDeclaration(db, declarationId, TRESORIER, '')).toThrow(
      expect.objectContaining({ statusCode: 422 }),
    )
    expect(() => rejeterDeclaration(db, declarationId, TRESORIER, 'non')).toThrow(
      expect.objectContaining({ statusCode: 422 }),
    )
  })

  it('place la cotisation en contestation et conserve le motif', () => {
    const { declarationId } = declarationDuMembre()
    rejeterDeclaration(db, declarationId, TRESORIER, 'Aucun envoi retrouvé à ce montant')

    const [d] = db.select().from(paymentDeclarations).where(eq(paymentDeclarations.id, declarationId)).all()
    expect(d!.decision).toBe('rejected')
    expect(d!.rejectionReason).toBe('Aucun envoi retrouvé à ce montant')

    const [c] = db.select().from(contributions).where(eq(contributions.id, d!.contributionId)).all()
    expect(c!.status).toBe('disputed')
  })
})

describe('« tout confirmer » — idempotence (acceptation T16)', () => {
  function deuxDeclarations() {
    const gereMembre = db.select().from(memberships).all().find(m => m.userId === MEMBRE)!
    const gerePresident = db.select().from(memberships).all().find(m => m.userId === PRESIDENT)!

    return [
      declarerPaiement(db, cotisationDe(gereMembre.id).id, MEMBRE, ENVOI).declarationId,
      declarerPaiement(db, cotisationDe(gerePresident.id).id, PRESIDENT, ENVOI).declarationId,
    ]
  }

  it('confirme le lot, puis ne refait rien au second passage', () => {
    const ids = deuxDeclarations()

    const premier = confirmerEnLot(db, ids, TRESORIER)
    expect(premier.confirmees).toBe(2)

    // Le trésorier retape sur le bouton parce que la liste n'a pas bougé.
    const second = confirmerEnLot(db, ids, TRESORIER)
    expect(second.confirmees).toBe(0)
    expect(second.ignorees).toHaveLength(2)

    // Et surtout, aucun double comptage.
    const confirmees = db.select().from(contributions).all().filter(c => c.confirmedAmount > 0)
    expect(confirmees.every(c => c.confirmedAmount === 25_000)).toBe(true)
  })

  it('ignore ses propres déclarations sans faire échouer le lot', () => {
    const gereTresorier = db.select().from(memberships).all().find(m => m.userId === TRESORIER)!
    const gereMembre = db.select().from(memberships).all().find(m => m.userId === MEMBRE)!

    const sienne = declarerPaiement(db, cotisationDe(gereTresorier.id).id, TRESORIER, ENVOI).declarationId
    const autre = declarerPaiement(db, cotisationDe(gereMembre.id).id, MEMBRE, ENVOI).declarationId

    const resultat = confirmerEnLot(db, [sienne, autre], TRESORIER)

    expect(resultat.confirmees).toBe(1)
    expect(resultat.ignorees).toEqual([{ id: sienne, raison: 'propre_declaration' }])
  })
})

describe('file d’attente', () => {
  it('ne liste que les déclarations en attente', () => {
    const gereMembre = db.select().from(memberships).all().find(m => m.userId === MEMBRE)!
    const { declarationId } = declarerPaiement(db, cotisationDe(gereMembre.id).id, MEMBRE, ENVOI)

    expect(fileDAttente(db, T)).toHaveLength(1)

    confirmerDeclaration(db, declarationId, TRESORIER)
    expect(fileDAttente(db, T)).toHaveLength(0)
  })
})
