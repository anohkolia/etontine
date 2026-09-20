import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  ESCALADE_HEURES, ESPECES_NON_CONFIRMEES_HEURES,
  escaladerDeclarations, reconnaitreVersement, signalerEspecesNonConfirmees,
} from '../../server/services/escalade.ts'
import { declarerEspeces, declarerPaiement } from '../../server/services/declarations.ts'
import { confirmerDeclaration } from '../../server/services/confirmations.ts'
import { ajouterMembreGere } from '../../server/services/membres.ts'
import { creerCanal } from '../../server/services/canaux.ts'
import { creerBrouillon, definirCanaux, majTontine, publier } from '../../server/services/tontines.ts'
import { demarrerTontine } from '../../server/services/tours.ts'
import { contributions, ledgerEntries, memberships, notifications, paymentDeclarations } from '../../server/db/schema.ts'
import { createTestDb, createTestUser } from '../helpers/db.ts'
import type { TestDb } from '../helpers/db.ts'

let db: TestDb
let cleanup: () => Promise<void>
let T: string

const PRESIDENT = 'd1000000-0000-4000-8000-000000000001'
const MEMBRE = 'd1000000-0000-4000-8000-000000000002'

const DEBUT = new Date('2026-01-15T09:00:00Z')
const heuresApres = (n: number) => new Date(DEBUT.getTime() + n * 3_600_000)

async function cotisationDuMembre() {
  const gere = (await db.select().from(memberships)).find(m => m.userId === MEMBRE)!
  return (await db.select().from(contributions)).find(c => c.membershipId === gere.id)!
}

beforeEach(async () => {
  const ctx = await createTestDb()
  db = ctx.db
  cleanup = ctx.cleanup

  await createTestUser(db, PRESIDENT, '+2250707000001')
  await createTestUser(db, MEMBRE, '+2250707000002')

  T = (await creerBrouillon(db, PRESIDENT, { name: 'Tontine des tantines', access: 'private' }))
  await majTontine(db, T, { shareAmount: 25_000, frequency: 'monthly', startDate: '2026-01-15' })
  await ajouterMembreGere(db, T, { name: 'Koffi', phone: '+2250707000002', shares: 1 })
  await ajouterMembreGere(db, T, { name: 'Fatou', phone: '+2250707000003', shares: 1 })

  const canal = await creerCanal(db, PRESIDENT, { provider: 'wave', msisdn: '+2250707000001', holderName: 'Aya' })
  await definirCanaux(db, T, [canal], PRESIDENT)
  await publier(db, T)
  await demarrerTontine(db, T, PRESIDENT)

  const gere = (await db.select().from(memberships)).find(m => m.managedName === 'Koffi')!
  await db.update(memberships).set({ userId: MEMBRE }).where(eq(memberships.id, gere.id))
})

afterEach(() => cleanup())

async function declarerAt(instant: Date) {
  const { declarationId } = await declarerPaiement(db, (await cotisationDuMembre()).id, MEMBRE, {
    amount: 25_000, channel: 'wave',
  })
  await db.update(paymentDeclarations)
    .set({ declaredAt: instant })
    .where(eq(paymentDeclarations.id, declarationId))
  return declarationId
}

describe('escalade à 48 h — acceptation T17', () => {
  it('n’escalade rien avant le délai', async () => {
    await declarerAt(DEBUT)
    expect(await escaladerDeclarations(db, heuresApres(ESCALADE_HEURES - 1))).toBe(0)
  })

  it('marque la déclaration escaladée passé 48 h', async () => {
    const declarationId = await declarerAt(DEBUT)
    expect(await escaladerDeclarations(db, heuresApres(ESCALADE_HEURES + 1))).toBe(1)

    const [d] = await db.select().from(paymentDeclarations).where(eq(paymentDeclarations.id, declarationId))
    expect(d!.escalatedAt).not.toBeNull()
  })

  it('rend l’alerte visible de tous au registre', async () => {
    await declarerAt(DEBUT)
    await escaladerDeclarations(db, heuresApres(ESCALADE_HEURES + 1))

    // C'est le point : un blocage qui ne figure pas au registre n'existe pas
    // pour le groupe. Le registre est lisible par tout membre actif.
    const ecritures = await db.select().from(ledgerEntries).where(eq(ledgerEntries.type, 'declaration_escalated'))
    expect(ecritures).toHaveLength(1)
    expect((ecritures[0]!.payload as { heuresDAttente: number }).heuresDAttente).toBe(ESCALADE_HEURES)
  })

  it('notifie le bureau, sans montant', async () => {
    await declarerAt(DEBUT)
    await escaladerDeclarations(db, heuresApres(ESCALADE_HEURES + 1))

    const envoyees = (await db.select().from(notifications))
      .filter(n => n.type === 'declaration_escaladee')
    expect(envoyees.length).toBeGreaterThan(0)
    expect(envoyees.every(n => !/FCFA|\d{4}/.test(`${n.title} ${n.body}`))).toBe(true)
  })

  it('est idempotente', async () => {
    await declarerAt(DEBUT)
    expect(await escaladerDeclarations(db, heuresApres(50))).toBe(1)
    expect(await escaladerDeclarations(db, heuresApres(72))).toBe(0)

    expect(await db.select().from(ledgerEntries).where(eq(ledgerEntries.type, 'declaration_escalated'))).toHaveLength(1)
  })

  it('n’escalade pas une déclaration déjà décidée', async () => {
    const declarationId = await declarerAt(DEBUT)
    await confirmerDeclaration(db, declarationId, PRESIDENT)

    expect(await escaladerDeclarations(db, heuresApres(72))).toBe(0)
  })
})

describe('espèces non reconnues à 72 h', () => {
  async function especesAt(instant: Date) {
    const { declarationId } = await declarerEspeces(db, (await cotisationDuMembre()).id, PRESIDENT, { amount: 25_000 })
    await db.update(paymentDeclarations)
      .set({ declaredAt: instant })
      .where(eq(paymentDeclarations.id, declarationId))
    return declarationId
  }

  it('ne signale rien avant le délai', async () => {
    await especesAt(DEBUT)
    expect(await signalerEspecesNonConfirmees(db, heuresApres(ESPECES_NON_CONFIRMEES_HEURES - 1))).toBe(0)
  })

  it('signale au registre passé 72 h', async () => {
    await especesAt(DEBUT)
    expect(await signalerEspecesNonConfirmees(db, heuresApres(ESPECES_NON_CONFIRMEES_HEURES + 1))).toBe(1)

    const ecritures = await db.select().from(ledgerEntries).where(eq(ledgerEntries.type, 'cash_unconfirmed'))
    expect(ecritures).toHaveLength(1)
  })

  it('ne signale rien si le membre a reconnu le versement', async () => {
    const declarationId = await especesAt(DEBUT)

    // Contrepartie de la déclaration par un tiers : le membre reconnaît.
    expect(await reconnaitreVersement(db, declarationId, MEMBRE)).toEqual({ ok: true })
    expect(await signalerEspecesNonConfirmees(db, heuresApres(96))).toBe(0)
  })

  it('refuse la reconnaissance par quelqu’un d’autre', async () => {
    const declarationId = await especesAt(DEBUT)
    expect(await reconnaitreVersement(db, declarationId, PRESIDENT)).toEqual({
      ok: false, raison: 'pas_le_sien',
    })
  })

  it('ne touche pas un envoi que le membre a déclaré lui-même', async () => {
    // Le contrôle ne vise que les déclarations faites **pour** quelqu'un.
    await declarerAt(DEBUT)
    expect(await signalerEspecesNonConfirmees(db, heuresApres(96))).toBe(0)
  })

  it('est idempotente', async () => {
    await especesAt(DEBUT)
    expect(await signalerEspecesNonConfirmees(db, heuresApres(80))).toBe(1)
    expect(await signalerEspecesNonConfirmees(db, heuresApres(100))).toBe(0)
  })
})
