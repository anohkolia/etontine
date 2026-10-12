import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { creerCanal } from '../../server/services/canaux.ts'
import { approuverDossier, rejeterDossier } from '../../server/services/kyc.ts'
import { transfererPresidence } from '../../server/services/membres.ts'
import {
  creerBrouillon, definirCanaux, demanderPublication, majTontine, publier, validerPublicationsDemandees,
} from '../../server/services/tontines.ts'
import { accepterInvitation, approuverAdhesion, creerInvitation } from '../../server/services/invitations.ts'
import { notifications, tontines, users } from '../../server/db/schema.ts'
import { createTestDb, createTestUser } from '../helpers/db.ts'
import type { TestDb } from '../helpers/db.ts'

/**
 * « Confirmer » une tontine avant que son identité soit vérifiée.
 *
 * Le président est envoyé vers la vérification, et sa demande est retenue : à
 * l'approbation de son identité, le brouillon est validé d'office — `draft →
 * open`, la transition de « Confirmer », avec exactement ses contrôles.
 */

let db: TestDb
let cleanup: () => Promise<void>

const PRESIDENT = 'b1000000-0000-4000-8000-000000000001'
const MEMBRE = 'b1000000-0000-4000-8000-000000000002'
const ADMIN = { id: 'b1000000-0000-4000-8000-000000000009', phone: '+2250707009999' }

beforeEach(async () => {
  const ctx = await createTestDb()
  db = ctx.db
  cleanup = ctx.cleanup

  await createTestUser(db, PRESIDENT, '+2250707000001')
  await createTestUser(db, MEMBRE, '+2250707000002')
  await createTestUser(db, ADMIN.id, ADMIN.phone)
  await db.update(users).set({ firstName: 'Aya', lastName: 'Koné', kycLevel: 1 }).where(eq(users.id, PRESIDENT))
  await db.update(users).set({ firstName: 'Koffi', lastName: 'Yao', kycLevel: 1 }).where(eq(users.id, MEMBRE))
})

afterEach(() => cleanup())

/** Un brouillon complet : rien ne manque, seule l'identité du président peut le retenir. */
async function brouillonComplet(nom = 'Tontine des tantines'): Promise<string> {
  const id = await creerBrouillon(db, PRESIDENT, { name: nom, access: 'private' })
  await majTontine(db, id, { shareAmount: 25_000 })
  const canal = await creerCanal(db, PRESIDENT, { provider: 'wave', msisdn: '+2250707000001', holderName: 'Aya Koné' })
  await definirCanaux(db, id, [canal], PRESIDENT)
  return id
}

async function verifier(userId = PRESIDENT) {
  await db.update(users).set({ kycLevel: 2, kycStatus: 'approved' }).where(eq(users.id, userId))
}

async function tontine(id: string) {
  const [t] = await db.select().from(tontines).where(eq(tontines.id, id))
  return t!
}

async function notificationsDe(userId: string) {
  return (await db.select().from(notifications)).filter(n => n.userId === userId)
}

describe('« Confirmer » sans identité vérifiée — la demande est retenue', () => {
  it('pose la demande sur le brouillon, qui reste un brouillon', async () => {
    const id = await brouillonComplet()
    await demanderPublication(db, id)

    const t = await tontine(id)
    expect(t.status).toBe('draft')
    expect(t.publishRequestedAt).toBeInstanceOf(Date)
  })

  it('garde la date de la première demande : c’est elle qui départage face au quota', async () => {
    const id = await brouillonComplet()
    await demanderPublication(db, id)
    const premiere = (await tontine(id)).publishRequestedAt

    await new Promise(r => setTimeout(r, 5))
    await demanderPublication(db, id)

    expect((await tontine(id)).publishRequestedAt).toEqual(premiere)
  })

  it('ne pose rien sur une tontine déjà publiée', async () => {
    const id = await brouillonComplet()
    await publier(db, id)
    await demanderPublication(db, id)

    expect((await tontine(id)).publishRequestedAt).toBeNull()
  })

  it('s’efface quand la tontine est publiée', async () => {
    const id = await brouillonComplet()
    await demanderPublication(db, id)
    await publier(db, id)

    const t = await tontine(id)
    expect(t.status).toBe('open')
    expect(t.publishRequestedAt).toBeNull()
  })
})

describe('validation d’office à l’approbation de l’identité', () => {
  it('valide le brouillon confirmé : draft → open, et le président l’apprend', async () => {
    const id = await brouillonComplet()
    await demanderPublication(db, id)
    await verifier()

    expect(await validerPublicationsDemandees(db, PRESIDENT)).toEqual([{ tontineId: id, validee: true }])

    const t = await tontine(id)
    expect(t.status).toBe('open')
    expect(t.publishRequestedAt).toBeNull()

    const [avis] = await notificationsDe(PRESIDENT)
    expect(avis).toMatchObject({ type: 'tontine_validee', tontineId: id, url: `/app/tontine/${id}/membres` })
    // Règle 21 : ni montant, ni nom de tontine — un nom peut porter un nombre.
    expect(`${avis!.title} ${avis!.body}`).not.toMatch(/FCFA|\d{4}|Tontine des tantines/)
  })

  it('ne touche pas à un brouillon qui n’a pas été confirmé', async () => {
    const id = await brouillonComplet()
    await verifier()

    expect(await validerPublicationsDemandees(db, PRESIDENT)).toEqual([])
    expect((await tontine(id)).status).toBe('draft')
  })

  it('ne valide rien tant que l’identité n’est pas vérifiée', async () => {
    const id = await brouillonComplet()
    await demanderPublication(db, id)

    expect(await validerPublicationsDemandees(db, PRESIDENT)).toEqual([])
    const t = await tontine(id)
    expect(t.status).toBe('draft')
    // La demande attend toujours son approbation.
    expect(t.publishRequestedAt).not.toBeNull()
  })

  it('laisse en brouillon ce qui est incomplet, efface la demande et dit pourquoi', async () => {
    const id = await creerBrouillon(db, PRESIDENT, { name: 'Sans numéro', access: 'private' })
    await majTontine(db, id, { shareAmount: 25_000 })
    await demanderPublication(db, id)
    await verifier()

    expect(await validerPublicationsDemandees(db, PRESIDENT)).toEqual([{ tontineId: id, validee: false }])

    const t = await tontine(id)
    expect(t.status).toBe('draft')
    // Traitée : il complétera, puis confirmera de nouveau — son identité,
    // elle, ne le retiendra plus.
    expect(t.publishRequestedAt).toBeNull()
    const [avis] = await notificationsDe(PRESIDENT)
    expect(avis).toMatchObject({ type: 'tontine_non_validee', tontineId: id, url: `/app/tontine/${id}` })
  })

  it('applique le quota du palier, dans l’ordre des demandes', async () => {
    // Palier gratuit : une tontine en cours à la fois.
    const premiere = await brouillonComplet('Première demandée')
    const seconde = await brouillonComplet('Seconde demandée')
    await demanderPublication(db, premiere)
    await new Promise(r => setTimeout(r, 5))
    await demanderPublication(db, seconde)
    await verifier()

    expect(await validerPublicationsDemandees(db, PRESIDENT)).toEqual([
      { tontineId: premiere, validee: true },
      { tontineId: seconde, validee: false },
    ])
    expect((await tontine(premiere)).status).toBe('open')
    expect((await tontine(seconde)).status).toBe('draft')

    // Rien ne manque à la seconde : c'est l'abonnement qui la retient, et
    // l'avis mène là où cela se règle.
    const refus = (await notificationsDe(PRESIDENT)).find(n => n.type === 'tontine_non_validee')
    expect(refus).toMatchObject({ tontineId: seconde, url: '/app/abonnement' })
    expect(refus!.body).toContain('abonnement')
  })

  it('ne valide que pour le président actuel', async () => {
    // Koffi rejoint, est accepté, puis reçoit la présidence du brouillon
    // qu'Aya avait confirmé. La validation d'Aya ne l'emporte pas avec elle.
    await verifier()
    const id = await brouillonComplet()
    const { token } = await creerInvitation(db, id, PRESIDENT)
    const { membershipId } = await accepterInvitation(db, token, MEMBRE)
    await approuverAdhesion(db, membershipId, PRESIDENT)
    await transfererPresidence(db, id, membershipId, PRESIDENT)
    await demanderPublication(db, id)

    expect(await validerPublicationsDemandees(db, PRESIDENT)).toEqual([])
    expect((await tontine(id)).status).toBe('draft')
  })

  it('ne fait jamais échouer l’approbation : une panne laisse la demande en place', async () => {
    const enPanne = {
      select: () => { throw new Error('base injoignable') },
    } as unknown as TestDb

    await expect(validerPublicationsDemandees(enPanne, PRESIDENT)).resolves.toEqual([])
  })
})

describe('approbation par un administrateur', () => {
  async function deposerDossier() {
    await db.update(users).set({ kycStatus: 'pending_review', kycSubmittedAt: new Date() }).where(eq(users.id, PRESIDENT))
  }

  it('valide d’office les tontines confirmées en attendant', async () => {
    const id = await brouillonComplet()
    await demanderPublication(db, id)
    await deposerDossier()

    await approuverDossier(db, PRESIDENT, ADMIN)

    expect((await tontine(id)).status).toBe('open')
    expect((await notificationsDe(PRESIDENT)).map(n => n.type).sort()).toEqual(['kyc_approuve', 'tontine_validee'])
  })

  it('n’en valide aucune sur un refus', async () => {
    const id = await brouillonComplet()
    await demanderPublication(db, id)
    await deposerDossier()

    await rejeterDossier(db, PRESIDENT, ADMIN, 'La photo de la pièce est floue.')

    const t = await tontine(id)
    expect(t.status).toBe('draft')
    // Il redéposera ; la demande l'attend toujours.
    expect(t.publishRequestedAt).not.toBeNull()
  })
})
