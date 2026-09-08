import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { FENETRE_DOUBLON_SECONDES, declarerEspeces, declarerPaiement } from '../../server/services/declarations.ts'
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
let maCotisation: string

const PRESIDENT = 'b1000000-0000-4000-8000-000000000001'
const TRESORIER = 'b1000000-0000-4000-8000-000000000010'

beforeEach(async () => {
  const ctx = createTestDb()
  db = ctx.db
  cleanup = ctx.cleanup
  vi.useRealTimers()

  await createTestUser(db, PRESIDENT, '+2250707000001')
  T = creerBrouillon(db, PRESIDENT, { name: 'Tontine des tantines', access: 'private' })
  majTontine(db, T, { shareAmount: 25_000, frequency: 'monthly', startDate: '2026-01-15' })

  ajouterMembreGere(db, T, { name: 'Koffi', phone: '+2250707000002', shares: 1 })
  const fatou = ajouterMembreGere(db, T, { name: 'Fatou', phone: '+2250707000003', shares: 1 })

  // Fatou a un compte et la casquette de trésorière, et c'est **porteur** :
  // sans un second membre de bureau, la déclaration du président serait
  // confirmée d'office faute de valideur possible. Ce fichier teste le cas
  // courant, celui d'un bureau qui a du monde ; le bureau d'une seule personne
  // a ses propres tests dans `confirmations.spec.ts`.
  await createTestUser(db, TRESORIER, '+2250707000003')
  db.update(memberships)
    .set({ userId: TRESORIER, role: 'treasurer' })
    .where(eq(memberships.id, fatou))
    .run()

  const canal = creerCanal(db, PRESIDENT, { provider: 'wave', msisdn: '+2250707000001', holderName: 'Aya' })
  marquerVerifie(db, canal)
  definirCanaux(db, T, [canal], PRESIDENT)
  publier(db, T)
  demarrerTontine(db, T, PRESIDENT)

  maCotisation = db.select().from(contributions).all()[0]!.id
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const ENVOI = { amount: 25_000, channel: 'wave' as const, providerRef: 'TX-1' }

describe('déclaration de paiement', () => {
  it('passe la cotisation à « déclaré », jamais à « confirmé »', () => {
    // T15 : déclarer n'est pas encaisser. Le vert dirait le contraire.
    const resultat = declarerPaiement(db, maCotisation, PRESIDENT, ENVOI)

    expect(resultat.contributionStatus).toBe('declared')

    const [c] = db.select().from(contributions).where(eq(contributions.id, maCotisation)).all()
    expect(c!.status).toBe('declared')
    expect(c!.confirmedAmount).toBe(0)
  })

  it('inscrit la déclaration au registre', () => {
    declarerPaiement(db, maCotisation, PRESIDENT, ENVOI)

    const ecritures = db.select().from(ledgerEntries).where(eq(ledgerEntries.type, 'contribution_declared')).all()
    expect(ecritures).toHaveLength(1)
    expect((ecritures[0]!.payload as { amount: number }).amount).toBe(25_000)
  })

  it('refuse de déclarer une cotisation déjà confirmée', () => {
    db.update(contributions).set({ status: 'confirmed' }).where(eq(contributions.id, maCotisation)).run()

    expect(() => declarerPaiement(db, maCotisation, PRESIDENT, ENVOI)).toThrow(
      expect.objectContaining({ statusCode: 409 }),
    )
  })
})

describe('garde-fou anti-double-déclaration — acceptation T15', () => {
  it('reconnaît un second envoi identique dans la fenêtre', () => {
    const premier = declarerPaiement(db, maCotisation, PRESIDENT, ENVOI)

    // Le membre impatient retape sur le bouton parce que rien ne s'affiche.
    db.update(contributions).set({ status: 'due' }).where(eq(contributions.id, maCotisation)).run()
    const second = declarerPaiement(db, maCotisation, PRESIDENT, ENVOI)

    expect(second.doublonEvite).toBe(true)
    expect(second.declarationId).toBe(premier.declarationId)
    expect(db.select().from(paymentDeclarations).all()).toHaveLength(1)
  })

  it('laisse passer un second envoi une fois la fenêtre écoulée', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T10:00:00Z'))
    declarerPaiement(db, maCotisation, PRESIDENT, ENVOI)

    // Un paiement partiel légitime dépasse largement 90 secondes.
    vi.setSystemTime(new Date(Date.now() + (FENETRE_DOUBLON_SECONDES + 10) * 1000))
    db.update(contributions).set({ status: 'due' }).where(eq(contributions.id, maCotisation)).run()

    const second = declarerPaiement(db, maCotisation, PRESIDENT, ENVOI)
    expect(second.doublonEvite).toBe(false)
    expect(db.select().from(paymentDeclarations).all()).toHaveLength(2)
  })

  it('ne confond pas deux montants différents', () => {
    declarerPaiement(db, maCotisation, PRESIDENT, ENVOI)
    db.update(contributions).set({ status: 'due' }).where(eq(contributions.id, maCotisation)).run()

    // Un paiement partiel n'est pas un doublon.
    const second = declarerPaiement(db, maCotisation, PRESIDENT, { ...ENVOI, amount: 10_000 })
    expect(second.doublonEvite).toBe(false)
  })
})

describe('déclaration d’espèces par le trésorier', () => {
  it('marque la source et notifie le membre concerné', async () => {
    const membreId = 'b1000000-0000-4000-8000-000000000002'
    await createTestUser(db, membreId, '+2250707000009')

    // On rattache le membre géré à un compte, pour qu'il soit notifiable.
    const { memberships } = await import('../../server/db/schema.ts')
    const [gere] = db.select().from(memberships).all().filter(m => m.managedName === 'Koffi')
    db.update(memberships).set({ userId: membreId }).where(eq(memberships.id, gere!.id)).run()

    const saCotisation = db.select().from(contributions).all()
      .find(c => c.membershipId === gere!.id)!

    declarerEspeces(db, saCotisation.id, PRESIDENT, { amount: 25_000 })

    const [declaration] = db.select().from(paymentDeclarations).all()
    expect(declaration!.source).toBe('treasurer')
    expect(declaration!.channel).toBe('cash')

    // Celui qui n'a pas envoyé lui-même doit pouvoir dire s'il reconnaît le
    // versement : c'est la contrepartie de cette dissymétrie.
    const envoyees = db.select().from(notifications).all()
    expect(envoyees.length).toBeGreaterThan(0)
    expect(envoyees.every(n => !/FCFA|\d{4}/.test(n.body))).toBe(true)
  })
})
