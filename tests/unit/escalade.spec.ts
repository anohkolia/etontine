import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  ESCALADE_HEURES, ESPECES_NON_CONFIRMEES_HEURES,
  escaladerDeclarations, reconnaitreVersement, signalerEspecesNonConfirmees,
} from '../../server/services/escalade.ts'
import { declarerEspeces, declarerPaiement } from '../../server/services/declarations.ts'
import { confirmerDeclaration } from '../../server/services/confirmations.ts'
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

const PRESIDENT = 'd1000000-0000-4000-8000-000000000001'
const MEMBRE = 'd1000000-0000-4000-8000-000000000002'

const DEBUT = new Date('2026-01-15T09:00:00Z')
const heuresApres = (n: number) => new Date(DEBUT.getTime() + n * 3_600_000)

function cotisationDuMembre() {
  const gere = db.select().from(memberships).all().find(m => m.userId === MEMBRE)!
  return db.select().from(contributions).all().find(c => c.membershipId === gere.id)!
}

beforeEach(async () => {
  const ctx = createTestDb()
  db = ctx.db
  cleanup = ctx.cleanup

  await createTestUser(db, PRESIDENT, '+2250707000001')
  await createTestUser(db, MEMBRE, '+2250707000002')

  T = creerBrouillon(db, PRESIDENT, { name: 'Tontine des tantines', access: 'private' })
  majTontine(db, T, { shareAmount: 25_000, frequency: 'monthly', startDate: '2026-01-15' })
  ajouterMembreGere(db, T, { name: 'Koffi', phone: '+2250707000002', shares: 1 })
  ajouterMembreGere(db, T, { name: 'Fatou', phone: '+2250707000003', shares: 1 })

  const canal = creerCanal(db, PRESIDENT, { provider: 'wave', msisdn: '+2250707000001', holderName: 'Aya' })
  marquerVerifie(db, canal)
  definirCanaux(db, T, [canal], PRESIDENT)
  publier(db, T)
  demarrerTontine(db, T, PRESIDENT)

  const gere = db.select().from(memberships).all().find(m => m.managedName === 'Koffi')!
  db.update(memberships).set({ userId: MEMBRE }).where(eq(memberships.id, gere.id)).run()
})

afterEach(() => cleanup())

function declarerAt(instant: Date) {
  const { declarationId } = declarerPaiement(db, cotisationDuMembre().id, MEMBRE, {
    amount: 25_000, channel: 'wave',
  })
  db.update(paymentDeclarations)
    .set({ declaredAt: instant })
    .where(eq(paymentDeclarations.id, declarationId))
    .run()
  return declarationId
}

describe('escalade à 48 h — acceptation T17', () => {
  it('n’escalade rien avant le délai', () => {
    declarerAt(DEBUT)
    expect(escaladerDeclarations(db, heuresApres(ESCALADE_HEURES - 1))).toBe(0)
  })

  it('marque la déclaration escaladée passé 48 h', () => {
    const declarationId = declarerAt(DEBUT)
    expect(escaladerDeclarations(db, heuresApres(ESCALADE_HEURES + 1))).toBe(1)

    const [d] = db.select().from(paymentDeclarations).where(eq(paymentDeclarations.id, declarationId)).all()
    expect(d!.escalatedAt).not.toBeNull()
  })

  it('rend l’alerte visible de tous au registre', () => {
    declarerAt(DEBUT)
    escaladerDeclarations(db, heuresApres(ESCALADE_HEURES + 1))

    // C'est le point : un blocage qui ne figure pas au registre n'existe pas
    // pour le groupe. Le registre est lisible par tout membre actif.
    const ecritures = db.select().from(ledgerEntries).where(eq(ledgerEntries.type, 'declaration_escalated')).all()
    expect(ecritures).toHaveLength(1)
    expect((ecritures[0]!.payload as { heuresDAttente: number }).heuresDAttente).toBe(ESCALADE_HEURES)
  })

  it('notifie le bureau, sans montant', () => {
    declarerAt(DEBUT)
    escaladerDeclarations(db, heuresApres(ESCALADE_HEURES + 1))

    const envoyees = db.select().from(notifications).all()
      .filter(n => n.type === 'declaration_escaladee')
    expect(envoyees.length).toBeGreaterThan(0)
    expect(envoyees.every(n => !/FCFA|\d{4}/.test(`${n.title} ${n.body}`))).toBe(true)
  })

  it('est idempotente', () => {
    declarerAt(DEBUT)
    expect(escaladerDeclarations(db, heuresApres(50))).toBe(1)
    expect(escaladerDeclarations(db, heuresApres(72))).toBe(0)

    expect(db.select().from(ledgerEntries).where(eq(ledgerEntries.type, 'declaration_escalated')).all()).toHaveLength(1)
  })

  it('n’escalade pas une déclaration déjà décidée', () => {
    const declarationId = declarerAt(DEBUT)
    confirmerDeclaration(db, declarationId, PRESIDENT)

    expect(escaladerDeclarations(db, heuresApres(72))).toBe(0)
  })
})

describe('espèces non reconnues à 72 h', () => {
  function especesAt(instant: Date) {
    const { declarationId } = declarerEspeces(db, cotisationDuMembre().id, PRESIDENT, { amount: 25_000 })
    db.update(paymentDeclarations)
      .set({ declaredAt: instant })
      .where(eq(paymentDeclarations.id, declarationId))
      .run()
    return declarationId
  }

  it('ne signale rien avant le délai', () => {
    especesAt(DEBUT)
    expect(signalerEspecesNonConfirmees(db, heuresApres(ESPECES_NON_CONFIRMEES_HEURES - 1))).toBe(0)
  })

  it('signale au registre passé 72 h', () => {
    especesAt(DEBUT)
    expect(signalerEspecesNonConfirmees(db, heuresApres(ESPECES_NON_CONFIRMEES_HEURES + 1))).toBe(1)

    const ecritures = db.select().from(ledgerEntries).where(eq(ledgerEntries.type, 'cash_unconfirmed')).all()
    expect(ecritures).toHaveLength(1)
  })

  it('ne signale rien si le membre a reconnu le versement', () => {
    const declarationId = especesAt(DEBUT)

    // Contrepartie de la déclaration par un tiers : le membre reconnaît.
    expect(reconnaitreVersement(db, declarationId, MEMBRE)).toEqual({ ok: true })
    expect(signalerEspecesNonConfirmees(db, heuresApres(96))).toBe(0)
  })

  it('refuse la reconnaissance par quelqu’un d’autre', () => {
    const declarationId = especesAt(DEBUT)
    expect(reconnaitreVersement(db, declarationId, PRESIDENT)).toEqual({
      ok: false, raison: 'pas_le_sien',
    })
  })

  it('ne touche pas un envoi que le membre a déclaré lui-même', () => {
    // Le contrôle ne vise que les déclarations faites **pour** quelqu'un.
    declarerAt(DEBUT)
    expect(signalerEspecesNonConfirmees(db, heuresApres(96))).toBe(0)
  })

  it('est idempotente', () => {
    especesAt(DEBUT)
    expect(signalerEspecesNonConfirmees(db, heuresApres(80))).toBe(1)
    expect(signalerEspecesNonConfirmees(db, heuresApres(100))).toBe(0)
  })
})
