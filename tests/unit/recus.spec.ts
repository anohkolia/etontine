import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { lienRecu, recu, recuSvg, signerRecu, verifierSignature } from '../../server/services/recus.ts'
import { formatMoney } from '#shared/format/money'
import { useMoney } from '../../app/composables/useMoney.ts'
import { declarerPaiement } from '../../server/services/declarations.ts'
import { confirmerDeclaration } from '../../server/services/confirmations.ts'
import { ajouterMembreGere } from '../../server/services/membres.ts'
import { creerCanal, marquerVerifie } from '../../server/services/canaux.ts'
import { creerBrouillon, definirCanaux, majTontine, publier } from '../../server/services/tontines.ts'
import { demarrerTontine } from '../../server/services/tours.ts'
import { contributions, memberships } from '../../server/db/schema.ts'
import { createTestDb, createTestUser } from '../helpers/db.ts'
import type { TestDb } from '../helpers/db.ts'

let db: TestDb
let cleanup: () => void
let declarationId: string

const PRESIDENT = 'e1000000-0000-4000-8000-000000000001'
const MEMBRE = 'e1000000-0000-4000-8000-000000000002'

beforeEach(async () => {
  const ctx = createTestDb()
  db = ctx.db
  cleanup = ctx.cleanup
  vi.useRealTimers()

  await createTestUser(db, PRESIDENT, '+2250707000001')
  await createTestUser(db, MEMBRE, '+2250707000002')

  const T = creerBrouillon(db, PRESIDENT, { name: 'Tontine des tantines', access: 'private' })
  majTontine(db, T, { shareAmount: 25_000, frequency: 'monthly', startDate: '2026-01-15' })
  ajouterMembreGere(db, T, { name: 'Koffi N’Guessan', phone: '+2250707000002', shares: 1 })
  ajouterMembreGere(db, T, { name: 'Fatou Diarra', phone: '+2250707000003', shares: 1 })

  const canal = creerCanal(db, PRESIDENT, { provider: 'wave', msisdn: '+2250707000001', holderName: 'Aya' })
  marquerVerifie(db, canal)
  definirCanaux(db, T, [canal], PRESIDENT)
  publier(db, T)
  demarrerTontine(db, T, PRESIDENT)

  const gere = db.select().from(memberships).all().find(m => m.managedName === 'Koffi N’Guessan')!
  db.update(memberships).set({ userId: MEMBRE }).where(eq(memberships.id, gere.id)).run()

  const sienne = db.select().from(contributions).all().find(c => c.membershipId === gere.id)!
  declarationId = declarerPaiement(db, sienne.id, MEMBRE, { amount: 25_000, channel: 'wave' }).declarationId
  confirmerDeclaration(db, declarationId, PRESIDENT)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('lien signé — acceptation T18', () => {
  it('accepte une signature valide et non expirée', () => {
    const expiration = new Date(Date.now() + 3_600_000)
    const signature = signerRecu(declarationId, expiration)

    expect(() => verifierSignature(declarationId, String(expiration.getTime()), signature)).not.toThrow()
  })

  it('refuse une signature falsifiée', () => {
    const expiration = new Date(Date.now() + 3_600_000)

    // Sans signature, une adresse devinable laisserait n'importe qui parcourir
    // les reçus en essayant des identifiants.
    expect(() => verifierSignature(declarationId, String(expiration.getTime()), 'faux')).toThrow(
      expect.objectContaining({ statusCode: 404 }),
    )
  })

  it('refuse une signature valable pour un autre reçu', () => {
    const expiration = new Date(Date.now() + 3_600_000)
    const signatureAutre = signerRecu('autre-declaration', expiration)

    expect(() => verifierSignature(declarationId, String(expiration.getTime()), signatureAutre)).toThrow()
  })

  it('refuse un lien expiré', () => {
    // Signer sans expiration reviendrait à publier le reçu pour toujours.
    const passee = new Date(Date.now() - 1_000)
    const signature = signerRecu(declarationId, passee)

    expect(() => verifierSignature(declarationId, String(passee.getTime()), signature)).toThrow(
      expect.objectContaining({
        data: { error: expect.objectContaining({ message: expect.stringContaining('expiré') }) },
      }),
    )
  })

  it('refuse une date d’expiration bricolée', () => {
    // Repousser l'expiration invalide la signature : les deux sont liées.
    const expiration = new Date(Date.now() + 3_600_000)
    const signature = signerRecu(declarationId, expiration)
    const plusTard = String(expiration.getTime() + 86_400_000)

    expect(() => verifierSignature(declarationId, plusTard, signature)).toThrow()
  })

  it('produit un lien complet et daté', () => {
    const { url, expiresAt } = lienRecu(declarationId, 'https://exemple.test')

    expect(url).toContain(`https://exemple.test/recu/${declarationId}`)
    expect(url).toContain('sig=')
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now())
  })
})

describe('contenu du reçu — ce qu’il ne divulgue pas', () => {
  it('ne montre que montant, date, tontine et membre', () => {
    const donnees = recu(db, declarationId)

    expect(donnees.amount).toBe(25_000)
    expect(donnees.tontineName).toBe('Tontine des tantines')
    expect(donnees.memberName).toBe('Koffi N’Guessan')
    expect(donnees.status).toBe('confirmed')
  })

  it('ne divulgue pas les autres membres', () => {
    // Un reçu circule par WhatsApp, souvent dans des groupes qui débordent du
    // cercle de la tontine.
    const texte = JSON.stringify(recu(db, declarationId)) + recuSvg(recu(db, declarationId))

    expect(texte).not.toContain('Fatou Diarra')
    expect(texte).not.toContain('+2250707000003')
  })

  it('ne divulgue pas l’état du pot ni les impayés', () => {
    const donnees = recu(db, declarationId)

    expect(Object.keys(donnees).sort()).toEqual([
      'amount', 'channel', 'confirmedAt', 'declaredAt',
      'id', 'memberName', 'roundIndex', 'status', 'tontineName',
    ])
  })
})

describe('image du reçu — poids', () => {
  it('pèse largement moins de 40 Ko', () => {
    const svg = recuSvg(recu(db, declarationId))
    const octets = Buffer.byteLength(svg, 'utf8')

    // Acceptation T18. Aucune police n'est embarquée (règle 16), ce qui garde
    // le fichier minuscule.
    expect(octets).toBeLessThan(40 * 1024)
    expect(octets).toBeGreaterThan(300) // et il contient bien quelque chose
  })

  it('est un SVG valide et échappe le contenu', () => {
    const donnees = recu(db, declarationId)
    const svg = recuSvg({ ...donnees, memberName: 'Aya <script>alert(1)</script>' })

    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).toContain('</svg>')
    // Un nom de membre est une donnée saisie : il ne doit pas devenir du balisage.
    expect(svg).not.toContain('<script>')
    expect(svg).toContain('&lt;script&gt;')
  })

  it('écrit le montant exactement comme l’interface', () => {
    // Deux montants différents pour la même somme dans deux documents d'une
    // même tontine, c'est ce qui déclenche une dispute.
    const { format } = useMoney()
    const svg = recuSvg(recu(db, declarationId))

    expect(formatMoney(25_000)).toBe(format(25_000))
    expect(svg).toContain(format(25_000))
  })
})
