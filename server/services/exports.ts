import { asc, eq } from 'drizzle-orm'
import ExcelJS from 'exceljs'
import PDFDocument from 'pdfkit'
import type { useDb } from '../db/index.ts'
import {
  contributions, ledgerEntries, memberships, payouts, rounds, shares, tontines, users,
} from '../db/schema.ts'
import { formatMoney } from '../../shared/format/money.ts'
import { apiError } from '../utils/errors.ts'

type Db = ReturnType<typeof useDb>

const MOIS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]

function dateLisible(valeur: Date | string): string {
  const d = valeur instanceof Date ? valeur : new Date(`${valeur}T00:00:00Z`)
  return `${d.getUTCDate()} ${MOIS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

function nomDe(ligne: { firstName: string | null, lastName: string | null, managedName: string | null }): string {
  return [ligne.firstName, ligne.lastName].filter(Boolean).join(' ')
    || ligne.managedName
    || 'Membre'
}

/** Le détail d'un tour : qui a cotisé quoi, et où en est le versement. */
export function detailTour(db: Db, roundId: string) {
  const [tour] = db
    .select({ round: rounds, tontine: tontines })
    .from(rounds)
    .innerJoin(tontines, eq(tontines.id, rounds.tontineId))
    .where(eq(rounds.id, roundId))
    .limit(1)
    .all()

  if (!tour) throw apiError('NOT_FOUND', 'Tour introuvable.')

  const lignes = db
    .select({
      contribution: contributions,
      rotationPosition: shares.rotationPosition,
      managedName: memberships.managedName,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(contributions)
    .innerJoin(shares, eq(shares.id, contributions.shareId))
    .innerJoin(memberships, eq(memberships.id, contributions.membershipId))
    .leftJoin(users, eq(users.id, memberships.userId))
    .where(eq(contributions.roundId, roundId))
    .orderBy(asc(shares.rotationPosition))
    .all()

  const [versement] = db.select().from(payouts).where(eq(payouts.roundId, roundId)).limit(1).all()

  const [beneficiaire] = db
    .select({
      managedName: memberships.managedName,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(shares)
    .innerJoin(memberships, eq(memberships.id, shares.membershipId))
    .leftJoin(users, eq(users.id, memberships.userId))
    .where(eq(shares.id, tour.round.beneficiaryShareId))
    .limit(1)
    .all()

  return {
    tontine: tour.tontine,
    round: tour.round,
    beneficiaire: beneficiaire ? nomDe(beneficiaire) : 'Membre',
    cotisations: lignes.map(l => ({
      nom: nomDe(l),
      position: l.rotationPosition,
      attendu: l.contribution.expectedAmount,
      confirme: l.contribution.confirmedAmount,
      statut: l.contribution.status,
    })),
    versement: versement ?? null,
  }
}

const LIBELLE_STATUT: Record<string, string> = {
  due: 'À cotiser',
  late: 'En retard',
  declared: 'Déclaré',
  confirmed: 'Confirmé',
  disputed: 'Contesté',
}

export interface LigneProcesVerbal {
  nom: string
  position: number
  attendu: number
  confirme: number
  statut: string
}

export interface StructureProcesVerbal {
  titre: string
  tontine: string
  locality: string | null
  tourIndex: number
  echeance: string
  beneficiaire: string
  cotisations: LigneProcesVerbal[]
  potAttendu: number
  potConstitue: number
  manquant: number
  versement: {
    montant: number
    moyen: string
    etat: string
    reception: string
  } | null
  /** Les blocs de signature. C'est ce qui fait un procès-verbal, pas un relevé. */
  signatures: string[]
}

/**
 * Contenu du procès-verbal, indépendamment de sa mise en page.
 *
 * Séparer la structure du rendu n'est pas de l'abstraction gratuite : un PDF
 * est compressé, donc invérifiable par lecture directe. En isolant ce que le
 * document **doit contenir**, l'acceptation du ticket — « le PV contient la
 * liste des cotisations du tour, le versement et un emplacement de signature »
 * — devient une propriété qu'on teste, et non une capture qu'on relit.
 */
export function structureProcesVerbal(db: Db, roundId: string): StructureProcesVerbal {
  const detail = detailTour(db, roundId)
  const potConstitue = detail.cotisations.reduce((n, c) => n + c.confirme, 0)

  return {
    titre: 'PROCÈS-VERBAL DE TOUR',
    tontine: detail.tontine.name,
    locality: detail.tontine.locality,
    tourIndex: detail.round.index,
    echeance: dateLisible(detail.round.dueDate),
    beneficiaire: detail.beneficiaire,
    cotisations: detail.cotisations.map(c => ({
      ...c,
      statut: LIBELLE_STATUT[c.statut] ?? c.statut,
    })),
    potAttendu: detail.round.expectedAmount,
    potConstitue,
    manquant: Math.max(0, detail.round.expectedAmount - potConstitue),
    versement: detail.versement
      ? {
          montant: detail.versement.amount,
          moyen: detail.versement.channel ?? '—',
          etat: detail.versement.status,
          reception: detail.versement.acknowledgedAt
            ? `Réception confirmée par le bénéficiaire le ${dateLisible(detail.versement.acknowledgedAt)}`
            : 'En attente de l’accusé de réception du bénéficiaire',
        }
      : null,
    // Une tontine se règle encore beaucoup à l'oral : le procès-verbal est ce
    // qui permet d'archiver un tour, et il ne vaut que signé.
    signatures: ['Le président', 'Le trésorier'],
  }
}

/**
 * Procès-verbal d'un tour, en PDF A4.
 *
 * Généré **côté serveur** (règle 17) : ni `jsPDF` ni `xlsx` ne doivent
 * atterrir dans le lot client, où ils pèseraient plus lourd que toute
 * l'application.
 *
 * Le document est pensé pour être **imprimé et signé**. La police est une
 * police standard PDF (Helvetica) : aucun fichier n'est embarqué, et le
 * document reste léger.
 */
export function procesVerbalPdf(db: Db, roundId: string): Promise<Buffer> {
  const pv = structureProcesVerbal(db, roundId)

  return new Promise((resoudre, rejeter) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 })
    const morceaux: Buffer[] = []

    doc.on('data', (m: Buffer) => morceaux.push(m))
    doc.on('end', () => resoudre(Buffer.concat(morceaux)))
    doc.on('error', rejeter)

    doc.fontSize(9).fillColor('#6d6d76').text(pv.titre, { characterSpacing: 1.5 })

    doc.moveDown(0.4)
    doc.fontSize(20).fillColor('#18181b').text(pv.tontine)

    doc.moveDown(0.2)
    doc.fontSize(11).fillColor('#52525b')
      .text(`Tour ${pv.tourIndex} — échéance du ${pv.echeance}`)
    if (pv.locality) doc.text(pv.locality)

    doc.moveDown(0.8)
    doc.fontSize(12).fillColor('#18181b').text(`Prend la main : ${pv.beneficiaire}`)

    // ---- Cotisations du tour ----
    doc.moveDown(1)
    doc.fontSize(13).fillColor('#18181b').text('Cotisations du tour')
    doc.moveDown(0.4)

    const gauche = doc.page.margins.left
    const largeur = doc.page.width - gauche - doc.page.margins.right
    const colonnes = [gauche, gauche + 210, gauche + 300, gauche + 400]

    doc.fontSize(9).fillColor('#6d6d76')
    doc.text('Membre', colonnes[0]!, doc.y)
    const yEntete = doc.y - 11
    doc.text('Part', colonnes[1]!, yEntete)
    doc.text('Attendu', colonnes[2]!, yEntete)
    doc.text('Confirmé', colonnes[3]!, yEntete)

    doc.moveTo(gauche, doc.y + 2).lineTo(gauche + largeur, doc.y + 2)
      .strokeColor('#d4d4d8').stroke()
    doc.moveDown(0.6)

    doc.fontSize(10)
    for (const c of pv.cotisations) {
      const y = doc.y
      doc.fillColor('#18181b').text(c.nom, colonnes[0]!, y, { width: 200 })
      doc.fillColor('#52525b').text(String(c.position), colonnes[1]!, y)
      doc.text(formatMoney(c.attendu), colonnes[2]!, y)
      doc.fillColor(c.confirme >= c.attendu ? '#065f46' : '#78350f')
        .text(
          c.confirme >= c.attendu ? formatMoney(c.confirme) : `${formatMoney(c.confirme)} (${c.statut})`,
          colonnes[3]!,
          y,
        )
      doc.moveDown(0.4)
    }

    doc.moveDown(0.4)
    doc.moveTo(gauche, doc.y).lineTo(gauche + largeur, doc.y).strokeColor('#d4d4d8').stroke()
    doc.moveDown(0.6)

    doc.fontSize(11).fillColor('#18181b')
      .text(`Pot attendu : ${formatMoney(pv.potAttendu)}`, gauche, doc.y)
    doc.text(`Pot constitué : ${formatMoney(pv.potConstitue)}`)

    if (pv.manquant > 0) {
      // Le manquant est écrit, jamais masqué.
      doc.fillColor('#991b1b').text(`Manquant : ${formatMoney(pv.manquant)}`)
    }

    // ---- Versement ----
    doc.moveDown(1)
    doc.fontSize(13).fillColor('#18181b').text('Versement du pot')
    doc.moveDown(0.4)
    doc.fontSize(10).fillColor('#52525b')

    if (pv.versement) {
      doc.text(`Montant versé : ${formatMoney(pv.versement.montant)}`)
      doc.text(`Moyen : ${pv.versement.moyen}`)
      doc.text(`État : ${pv.versement.etat}`)
      doc.text(pv.versement.reception)
    }
    else {
      doc.text('Le pot n’a pas encore été versé.')
    }

    // ---- Signatures ----
    doc.moveDown(2)
    doc.fontSize(13).fillColor('#18181b').text('Signatures')
    doc.moveDown(1.2)

    const ySignature = doc.y
    const largeurBloc = (largeur - 40) / pv.signatures.length

    for (const [i, role] of pv.signatures.entries()) {
      const x = gauche + i * (largeurBloc + 40)
      doc.moveTo(x, ySignature + 46).lineTo(x + largeurBloc, ySignature + 46)
        .strokeColor('#18181b').stroke()
      doc.fontSize(10).fillColor('#52525b').text(role, x, ySignature + 52)
    }

    doc.moveDown(4)
    doc.fontSize(8).fillColor('#6d6d76')
      .text(
        `Document généré le ${dateLisible(new Date())} — Tontine CI`,
        gauche,
        doc.page.height - doc.page.margins.bottom - 20,
      )

    doc.end()
  })
}

/**
 * Export du registre au format Excel.
 *
 * Deux feuilles : le registre chaîné et le détail des cotisations. Les montants
 * sont des **nombres**, pas du texte formaté : un trésorier qui exporte veut
 * pouvoir additionner. Le format d'affichage reste conforme à la règle 7, mais
 * il est porté par le format de cellule.
 */
export async function registreXlsx(db: Db, tontineId: string): Promise<Buffer> {
  const [tontine] = db.select().from(tontines).where(eq(tontines.id, tontineId)).limit(1).all()
  if (!tontine) throw apiError('NOT_FOUND', 'Tontine introuvable.')

  const classeur = new ExcelJS.Workbook()
  classeur.creator = 'Tontine CI'
  classeur.created = new Date()

  // ---- Feuille 1 : le registre ----
  const feuilleRegistre = classeur.addWorksheet('Registre')
  feuilleRegistre.columns = [
    { header: 'Position', key: 'position', width: 10 },
    { header: 'Date', key: 'date', width: 20 },
    { header: 'Type', key: 'type', width: 26 },
    { header: 'Tour', key: 'tour', width: 8 },
    { header: 'Détail', key: 'detail', width: 60 },
  ]
  feuilleRegistre.getRow(1).font = { bold: true }

  const ecritures = db
    .select({ entry: ledgerEntries, roundIndex: rounds.index })
    .from(ledgerEntries)
    .leftJoin(rounds, eq(rounds.id, ledgerEntries.roundId))
    .where(eq(ledgerEntries.tontineId, tontineId))
    .orderBy(asc(ledgerEntries.position))
    .all()

  for (const e of ecritures) {
    feuilleRegistre.addRow({
      position: e.entry.position,
      date: e.entry.serverTimestamp,
      type: e.entry.type,
      tour: e.roundIndex ?? '',
      detail: JSON.stringify(e.entry.payload),
    })
  }
  feuilleRegistre.getColumn('date').numFmt = 'dd/mm/yyyy hh:mm'

  // ---- Feuille 2 : les cotisations ----
  const feuilleCotisations = classeur.addWorksheet('Cotisations')
  feuilleCotisations.columns = [
    { header: 'Tour', key: 'tour', width: 8 },
    { header: 'Échéance', key: 'echeance', width: 14 },
    { header: 'Membre', key: 'membre', width: 28 },
    { header: 'Part', key: 'part', width: 8 },
    { header: 'Attendu (FCFA)', key: 'attendu', width: 16 },
    { header: 'Confirmé (FCFA)', key: 'confirme', width: 16 },
    { header: 'Statut', key: 'statut', width: 14 },
  ]
  feuilleCotisations.getRow(1).font = { bold: true }

  const lignes = db
    .select({
      roundIndex: rounds.index,
      dueDate: contributions.dueDate,
      rotationPosition: shares.rotationPosition,
      expectedAmount: contributions.expectedAmount,
      confirmedAmount: contributions.confirmedAmount,
      status: contributions.status,
      managedName: memberships.managedName,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(contributions)
    .innerJoin(rounds, eq(rounds.id, contributions.roundId))
    .innerJoin(shares, eq(shares.id, contributions.shareId))
    .innerJoin(memberships, eq(memberships.id, contributions.membershipId))
    .leftJoin(users, eq(users.id, memberships.userId))
    .where(eq(rounds.tontineId, tontineId))
    .orderBy(asc(rounds.index), asc(shares.rotationPosition))
    .all()

  for (const l of lignes) {
    feuilleCotisations.addRow({
      tour: l.roundIndex,
      echeance: l.dueDate,
      membre: nomDe(l),
      part: l.rotationPosition,
      // Des nombres, pas du texte : un trésorier qui exporte veut additionner.
      attendu: l.expectedAmount,
      confirme: l.confirmedAmount,
      statut: LIBELLE_STATUT[l.status] ?? l.status,
    })
  }

  // Séparateur de milliers dans le format de cellule, sans décimale (règle 7).
  feuilleCotisations.getColumn('attendu').numFmt = '# ##0'
  feuilleCotisations.getColumn('confirme').numFmt = '# ##0'

  const donnees = await classeur.xlsx.writeBuffer()
  return Buffer.from(donnees)
}
