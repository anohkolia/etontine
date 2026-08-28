import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { procesVerbalPdf, registreXlsx, structureProcesVerbal } from '../../server/services/exports.ts'
import { declarerPaiement } from '../../server/services/declarations.ts'
import { confirmerDeclaration } from '../../server/services/confirmations.ts'
import {
  accuserReception, declarerVersement, preparerVersement,
} from '../../server/services/versements.ts'
import { ajouterMembreGere } from '../../server/services/membres.ts'
import { creerCanal, marquerVerifie } from '../../server/services/canaux.ts'
import { creerBrouillon, definirCanaux, majTontine, publier } from '../../server/services/tontines.ts'
import { demarrerTontine } from '../../server/services/tours.ts'
import { contributions, memberships, rounds, tontines } from '../../server/db/schema.ts'
import { createTestDb, createTestUser } from '../helpers/db.ts'
import type { TestDb } from '../helpers/db.ts'

let db: TestDb
let cleanup: () => void
let T: string
let tour1: string

const PRESIDENT = 'a2000000-0000-4000-8000-000000000001'
const TRESORIER = 'a2000000-0000-4000-8000-000000000002'

beforeEach(async () => {
  const ctx = createTestDb()
  db = ctx.db
  cleanup = ctx.cleanup

  await createTestUser(db, PRESIDENT, '+2250707001111')
  await createTestUser(db, TRESORIER, '+2250707002222')

  T = creerBrouillon(db, PRESIDENT, { name: 'Tontine des tantines', access: 'private' })
  majTontine(db, T, {
    shareAmount: 25_000, frequency: 'monthly', startDate: '2026-01-15', locality: 'Abobo',
  })
  ajouterMembreGere(db, T, { name: 'Koffi N’Guessan', phone: '+2250707002222', shares: 1 })
  ajouterMembreGere(db, T, { name: 'Fatou Diarra', phone: '+2250707003333', shares: 1 })

  const canal = creerCanal(db, PRESIDENT, { provider: 'wave', msisdn: '+2250707001111', holderName: 'Aya' })
  marquerVerifie(db, canal)
  definirCanaux(db, T, [canal], PRESIDENT)
  publier(db, T)
  demarrerTontine(db, T, PRESIDENT)

  const gere = db.select().from(memberships).all().find(m => m.managedName === 'Koffi N’Guessan')!
  db.update(memberships).set({ userId: TRESORIER, role: 'treasurer' }).where(eq(memberships.id, gere.id)).run()

  tour1 = db.select().from(rounds).all().find(r => r.index === 1)!.id
})

afterEach(() => cleanup())

function confirmerTout() {
  for (const c of db.select().from(contributions).all().filter(x => x.roundId === tour1)) {
    const msPresident = db.select().from(memberships).all().find(m => m.userId === PRESIDENT)!.id
    const declarant = c.membershipId === msPresident ? PRESIDENT : TRESORIER
    const decideur = declarant === PRESIDENT ? TRESORIER : PRESIDENT
    const { declarationId } = declarerPaiement(db, c.id, declarant, { amount: 25_000, channel: 'wave' })
    confirmerDeclaration(db, declarationId, decideur)
  }
}

describe('procès-verbal PDF — acceptation T20', () => {
  it('produit un PDF valide', async () => {
    confirmerTout()
    const pdf = await procesVerbalPdf(db, tour1)

    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-')
    expect(pdf.length).toBeGreaterThan(1_000)
  })

  it('contient les cotisations du tour, le versement et un emplacement de signature', () => {
    confirmerTout()
    db.update(tontines).set({ counterValidationThreshold: 500_000 }).where(eq(tontines.id, T)).run()
    preparerVersement(db, tour1, TRESORIER, { beneficiaryPhoneLast4: '1111', acceptIncompletePot: false })
    declarerVersement(db, tour1, TRESORIER, { channel: 'wave' })
    accuserReception(db, tour1, PRESIDENT, 75_000)

    // Un PDF est compressé, donc invérifiable par lecture directe : c'est la
    // structure du document qui porte le contrat de contenu.
    const pv = structureProcesVerbal(db, tour1)

    expect(pv.cotisations).toHaveLength(3)
    expect(pv.cotisations.every(c => c.confirme === 25_000)).toBe(true)
    expect(pv.versement).toMatchObject({ montant: 75_000, etat: 'acknowledged' })
    expect(pv.versement!.reception).toContain('Réception confirmée')

    // L'emplacement de signature : c'est ce qui fait un procès-verbal.
    expect(pv.signatures).toEqual(['Le président', 'Le trésorier'])
  })

  it('mentionne le manquant quand le pot est incomplet', () => {
    // Rien n'est confirmé : le pot est vide, et le document doit le dire.
    const pv = structureProcesVerbal(db, tour1)

    expect(pv.potConstitue).toBe(0)
    expect(pv.manquant).toBe(75_000)
    expect(pv.cotisations.every(c => c.statut === 'À cotiser')).toBe(true)
  })
})

describe('export Excel', () => {
  it('produit un classeur xlsx valide', async () => {
    confirmerTout()
    const classeur = await registreXlsx(db, T)

    // Un .xlsx est une archive ZIP : elle commence par « PK ».
    expect(classeur.subarray(0, 2).toString('ascii')).toBe('PK')
    expect(classeur.length).toBeGreaterThan(1_000)
  })

  it('contient une feuille par sujet', async () => {
    confirmerTout()
    const ExcelJS = (await import('exceljs')).default
    const classeur = new ExcelJS.Workbook()
    await classeur.xlsx.load(await registreXlsx(db, T) as never)

    expect(classeur.worksheets.map(f => f.name)).toEqual(['Registre', 'Cotisations'])
  })

  it('écrit les montants comme des nombres, pas comme du texte', async () => {
    confirmerTout()
    const ExcelJS = (await import('exceljs')).default
    const classeur = new ExcelJS.Workbook()
    await classeur.xlsx.load(await registreXlsx(db, T) as never)

    const feuille = classeur.getWorksheet('Cotisations')!
    // Les clés de colonne ne survivent pas à l'écriture du fichier : on vise
    // la colonne par sa position, comme le ferait un tableur.
    const cellule = feuille.getRow(2).getCell(5)

    // Un trésorier qui exporte veut pouvoir additionner.
    expect(typeof cellule.value).toBe('number')
    expect(cellule.value).toBe(25_000)
  })

  it('liste toutes les cotisations de tous les tours', async () => {
    const ExcelJS = (await import('exceljs')).default
    const classeur = new ExcelJS.Workbook()
    await classeur.xlsx.load(await registreXlsx(db, T) as never)

    const feuille = classeur.getWorksheet('Cotisations')!
    // Trois parts × trois tours, plus la ligne d'en-tête.
    expect(feuille.rowCount).toBe(10)
  })
})
