import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  approuverDossier, dossier, dossiersEnAttente, dossiersTraites,
  journalAdministration, journaliserConsultation, rejeterDossier, urlPiece,
} from '../../server/services/kyc.ts'
import { estAdministrateur, numerosAdministrateurs } from '../../server/utils/admin.ts'
import { decomposerUrlPiece, lirePiece } from '../../server/utils/fichiers.ts'
import { adminAudit, notifications, users } from '../../server/db/schema.ts'
import { createTestDb, createTestUser } from '../helpers/db.ts'
import type { TestDb } from '../helpers/db.ts'

let db: TestDb
let cleanup: () => void

const ADMIN = { id: 'aaaa0000-0000-4000-8000-000000000001', phone: '+2250707001111' }
const DEMANDEUR = 'aaaa0000-0000-4000-8000-000000000002'
const AUTRE = 'aaaa0000-0000-4000-8000-000000000003'

async function poserDossier(id: string, quand: Date) {
  db.update(users).set({
    firstName: 'Aya',
    lastName: 'Koné',
    kycStatus: 'pending_review',
    kycDocumentUrl: '/api/v1/uploads/proof/aaaa0000-0000-4000-8000-000000000002/'
      + 'bbbb0000-0000-4000-8000-000000000001.jpg',
    kycSelfieUrl: '/api/v1/uploads/proof/aaaa0000-0000-4000-8000-000000000002/'
      + 'bbbb0000-0000-4000-8000-000000000002.jpg',
    kycSubmittedAt: quand,
  }).where(eq(users.id, id)).run()
}

beforeEach(async () => {
  const ctx = createTestDb()
  db = ctx.db
  cleanup = ctx.cleanup

  await createTestUser(db, ADMIN.id, ADMIN.phone)
  await createTestUser(db, DEMANDEUR, '+2250707002222')
  await createTestUser(db, AUTRE, '+2250707003333')
})

afterEach(() => cleanup())

describe('liste blanche des administrateurs', () => {
  const initial = process.env.NUXT_ADMIN_PHONES

  afterEach(() => {
    if (initial === undefined) delete process.env.NUXT_ADMIN_PHONES
    else process.env.NUXT_ADMIN_PHONES = initial
  })

  it('normalise les numéros comme partout ailleurs', () => {
    process.env.NUXT_ADMIN_PHONES = '07 07 00 11 11, 0505000001'
    expect(numerosAdministrateurs()).toEqual(['+2250707001111', '+2250505000001'])
  })

  it('reconnaît un administrateur quelle que soit la notation saisie', () => {
    process.env.NUXT_ADMIN_PHONES = '+2250707001111'
    expect(estAdministrateur('+2250707001111')).toBe(true)
    expect(estAdministrateur('+2250707009999')).toBe(false)
  })

  it('n’accorde le statut à personne quand rien n’est configuré', () => {
    // Un back-office inaccessible vaut mieux qu'un back-office ouvert par défaut.
    delete process.env.NUXT_ADMIN_PHONES
    expect(estAdministrateur('+2250707001111')).toBe(false)

    process.env.NUXT_ADMIN_PHONES = ''
    expect(estAdministrateur('+2250707001111')).toBe(false)
  })

  it('ignore un numéro mal saisi sans donner de droits', () => {
    process.env.NUXT_ADMIN_PHONES = 'pas-un-numero, +2250707001111'
    expect(numerosAdministrateurs()).toEqual(['+2250707001111'])
    expect(estAdministrateur('pas-un-numero')).toBe(false)
  })

  it('ne dérive jamais le statut de la base de données', async () => {
    // La propriété qui compte : écrire dans `users` ne donne pas les droits
    // d'administration. Une compromission de la base ne suffit pas.
    process.env.NUXT_ADMIN_PHONES = '+2250707001111'
    db.update(users).set({ kycLevel: 3 }).where(eq(users.id, AUTRE)).run()

    expect(estAdministrateur('+2250707003333')).toBe(false)
  })
})

describe('file des dossiers', () => {
  it('classe du plus ancien au plus récent', async () => {
    await poserDossier(DEMANDEUR, new Date('2026-01-10T09:00:00Z'))
    await poserDossier(AUTRE, new Date('2026-01-12T09:00:00Z'))

    // Une file triée à l'envers laisse les dossiers difficiles s'enfoncer.
    expect(dossiersEnAttente(db).map(d => d.userId)).toEqual([DEMANDEUR, AUTRE])
  })

  it('ne montre pas où sont rangées les pièces', async () => {
    await poserDossier(DEMANDEUR, new Date())
    const [d] = dossiersEnAttente(db)

    expect(d!.hasDocument).toBe(true)
    expect(d!.hasSelfie).toBe(true)
    expect(JSON.stringify(d)).not.toContain('/uploads/')
  })

  it('sépare les dossiers traités de ceux en attente', async () => {
    await poserDossier(DEMANDEUR, new Date())
    await poserDossier(AUTRE, new Date())
    approuverDossier(db, DEMANDEUR, ADMIN)

    expect(dossiersEnAttente(db).map(d => d.userId)).toEqual([AUTRE])
    expect(dossiersTraites(db).map(d => d.userId)).toEqual([DEMANDEUR])
  })
})

describe('approbation', () => {
  beforeEach(async () => poserDossier(DEMANDEUR, new Date()))

  it('accorde le palier 2', () => {
    approuverDossier(db, DEMANDEUR, ADMIN)

    const d = dossier(db, DEMANDEUR)
    expect(d.kycStatus).toBe('approved')
    expect(d.kycLevel).toBe(2)
  })

  it('journalise la décision avec son auteur', () => {
    approuverDossier(db, DEMANDEUR, ADMIN)

    const journal = journalAdministration(db)
    expect(journal).toHaveLength(1)
    expect(journal[0]!.action).toBe('kyc_approuve')
    expect(journal[0]!.actorId).toBe(ADMIN.id)
    // Le numéro est figé : si l'administrateur en change, le journal reste lisible.
    expect(journal[0]!.actorPhone).toBe(ADMIN.phone)
    expect(journal[0]!.targetUserId).toBe(DEMANDEUR)
  })

  it('prévient la personne, sans montant', () => {
    approuverDossier(db, DEMANDEUR, ADMIN)

    const envoyees = db.select().from(notifications).all().filter(n => n.userId === DEMANDEUR)
    expect(envoyees).toHaveLength(1)
    expect(`${envoyees[0]!.title} ${envoyees[0]!.body}`).not.toMatch(/FCFA|\d{4}/)
  })

  it('refuse d’approuver son propre dossier', async () => {
    // Même règle de séparation que pour les cotisations : personne ne se
    // délivre un quitus à soi-même.
    await poserDossier(ADMIN.id, new Date())

    expect(() => approuverDossier(db, ADMIN.id, ADMIN)).toThrow(
      expect.objectContaining({ statusCode: 403 }),
    )
  })

  it('refuse une seconde décision', () => {
    approuverDossier(db, DEMANDEUR, ADMIN)

    expect(() => approuverDossier(db, DEMANDEUR, ADMIN)).toThrow(
      expect.objectContaining({ statusCode: 409 }),
    )
    expect(() => rejeterDossier(db, DEMANDEUR, ADMIN, 'Motif suffisamment long')).toThrow(
      expect.objectContaining({ statusCode: 409 }),
    )
  })
})

describe('rejet', () => {
  beforeEach(async () => poserDossier(DEMANDEUR, new Date()))

  it('exige un motif explicite', () => {
    // Un refus sans explication est un cul-de-sac : la personne redépose la
    // même chose et l'on repart pour un tour.
    for (const motif of ['', 'flou', 'illisible']) {
      expect(() => rejeterDossier(db, DEMANDEUR, ADMIN, motif)).toThrow(
        expect.objectContaining({ statusCode: 422 }),
      )
    }
  })

  it('conserve le motif et le transmet', () => {
    rejeterDossier(db, DEMANDEUR, ADMIN, 'La pièce est illisible : le numéro n’apparaît pas.')

    const d = dossier(db, DEMANDEUR)
    expect(d.kycStatus).toBe('rejected')
    expect(d.rejectionReason).toContain('illisible')

    const envoyees = db.select().from(notifications).all().filter(n => n.userId === DEMANDEUR)
    expect(envoyees).toHaveLength(1)
  })

  it('ne retire pas un palier déjà acquis', () => {
    db.update(users).set({ kycLevel: 2 }).where(eq(users.id, DEMANDEUR)).run()
    rejeterDossier(db, DEMANDEUR, ADMIN, 'Le selfie ne correspond pas à la pièce.')

    // Un dépôt raté ne fait pas perdre ce qui était déjà accordé.
    expect(dossier(db, DEMANDEUR).kycLevel).toBe(2)
  })
})

describe('journal — consulter est une action', () => {
  it('consigne chaque consultation de pièce', async () => {
    await poserDossier(DEMANDEUR, new Date())

    journaliserConsultation(db, ADMIN, DEMANDEUR, 'document')
    journaliserConsultation(db, ADMIN, DEMANDEUR, 'selfie')

    const journal = db.select().from(adminAudit).all()
    expect(journal).toHaveLength(2)
    expect(journal.every(e => e.action === 'kyc_piece_consultee')).toBe(true)
  })

  it('rend l’adresse de la pièce, réservée au service', async () => {
    await poserDossier(DEMANDEUR, new Date())

    expect(urlPiece(db, DEMANDEUR, 'document')).toContain('bbbb0000')
    expect(urlPiece(db, AUTRE, 'document')).toBeNull()
  })
})

describe('lecture des pièces — traversée de chemin', () => {
  let racine: string
  const initialCwd = process.cwd()

  beforeEach(() => {
    racine = mkdtempSync(join(tmpdir(), 'tontine-pieces-'))
    mkdirSync(join(racine, 'data', 'preuves', DEMANDEUR), { recursive: true })
    writeFileSync(
      join(racine, 'data', 'preuves', DEMANDEUR, 'bbbb0000-0000-4000-8000-000000000001.jpg'),
      Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]),
    )
    writeFileSync(join(racine, 'secret.txt'), 'ne doit jamais sortir')
    process.chdir(racine)
  })

  afterEach(() => {
    process.chdir(initialCwd)
    rmSync(racine, { recursive: true, force: true })
  })

  it('lit une pièce légitime', async () => {
    const piece = await lirePiece(DEMANDEUR, 'bbbb0000-0000-4000-8000-000000000001.jpg')

    expect(piece).not.toBeNull()
    expect(piece!.type).toBe('image/jpeg')
  })

  it('refuse tout ce qui n’est pas un nom attendu', async () => {
    // Filtrer les `..` d'un chemin fourni par l'appelant est un jeu qu'on perd :
    // encodages, séparateurs alternatifs, normalisation Unicode. Un motif fermé
    // ne laisse passer que ce qu'on a soi-même écrit.
    for (const nom of [
      '../../../secret.txt',
      '..%2F..%2Fsecret.txt',
      'bbbb0000-0000-4000-8000-000000000001.jpg/../../secret.txt',
      'bbbb0000-0000-4000-8000-000000000001.exe',
      'secret.txt',
      '.env',
    ]) {
      expect(await lirePiece(DEMANDEUR, nom), nom).toBeNull()
    }
  })

  it('refuse un propriétaire qui n’est pas un identifiant', async () => {
    for (const proprietaire of ['..', '../..', 'nimportequoi']) {
      expect(await lirePiece(proprietaire, 'bbbb0000-0000-4000-8000-000000000001.jpg')).toBeNull()
    }
  })

  it('accepte aussi bien un chemin qu’une URL absolue', () => {
    // Le dépôt renvoie un chemin relatif, mais le dossier d'identité valide
    // ses champs comme des URL absolues : un client conforme aux deux stocke
    // une adresse absolue. N'accepter que le chemin rendait les pièces
    // introuvables, sans autre symptôme qu'un 404.
    const attendu = { userId: DEMANDEUR, nom: 'bbbb0000-0000-4000-8000-000000000001.jpg' }
    const chemin = `/api/v1/uploads/proof/${DEMANDEUR}/${attendu.nom}`

    expect(decomposerUrlPiece(chemin)).toEqual(attendu)
    expect(decomposerUrlPiece(`http://localhost:3000${chemin}`)).toEqual(attendu)
    expect(decomposerUrlPiece(`https://tontine.ci${chemin}`)).toEqual(attendu)
  })

  it('ne décompose que les adresses de pièces qu’on a fabriquées', () => {
    expect(decomposerUrlPiece(
      `/api/v1/uploads/proof/${DEMANDEUR}/bbbb0000-0000-4000-8000-000000000001.jpg`,
    )).toEqual({ userId: DEMANDEUR, nom: 'bbbb0000-0000-4000-8000-000000000001.jpg' })

    for (const url of [
      '/api/v1/uploads/proof/../../etc/passwd',
      '/api/v1/uploads/proof/x/y',
      'https://ailleurs.test/piece.jpg',
      '/api/v1/uploads/proof/' + DEMANDEUR + '/secret.txt',
      // Un hôte étranger ne doit pas non plus servir de détour : seul le
      // chemin compte, et il doit être exactement celui qu'on fabrique.
      'https://ailleurs.test/api/v1/uploads/proof/x/y.jpg',
    ]) {
      expect(decomposerUrlPiece(url), url).toBeNull()
    }
  })
})
