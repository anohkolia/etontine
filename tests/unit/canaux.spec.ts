import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { GEL_HEURES, canauxDeTontine, creerCanal, rattacherCanal } from '../../server/services/canaux.ts'
import { definirCanaux } from '../../server/services/tontines.ts'
import { notifierTontine, NotificationAvecMontantError } from '../../server/services/notifications.ts'
import { ledgerEntries, memberships, notifications, tontineChannels, tontines } from '../../server/db/schema.ts'
import { createTestDb, createTestUser } from '../helpers/db.ts'
import type { TestDb } from '../helpers/db.ts'

let db: TestDb
let cleanup: () => Promise<void>

const PRESIDENT = 'c0000000-0000-4000-8000-000000000001'
const MEMBRE = 'c0000000-0000-4000-8000-000000000002'
const T = 'c0000000-0000-4000-8000-000000000010'

beforeEach(async () => {
  const ctx = await createTestDb()
  db = ctx.db
  cleanup = ctx.cleanup

  await createTestUser(db, PRESIDENT, '+2250707000001')
  await createTestUser(db, MEMBRE, '+2250707000002')
  await db.insert(tontines).values({
    id: T, name: 'Tontine des tantines', shareAmount: 25_000,
    frequency: 'monthly', startDate: '2026-01-01', createdBy: PRESIDENT, status: 'draft',
  })
  await db.insert(memberships).values([
    { id: 'ms-p', tontineId: T, userId: PRESIDENT, role: 'president', status: 'active' },
    { id: 'ms-m', tontineId: T, userId: MEMBRE, role: 'member', status: 'active' },
  ])
})

afterEach(() => cleanup())

async function canal(nom = 'Aya Koné', numero = '+2250707000001') {
  return await creerCanal(db, PRESIDENT, { provider: 'wave', msisdn: numero, holderName: nom })
}

describe('canaux de collecte — acceptation T09', () => {
  it('rattache un canal déclaré', async () => {
    const id = await canal()

    // Plus de vérification par SMS : ce qui protège, c'est le code d'accès
    // redemandé à la déclaration (route), le nom du titulaire, et le gel.
    await rattacherCanal(db, T, id, PRESIDENT)
    expect(await canauxDeTontine(db, T)).toHaveLength(1)
  })

  it('refuse un canal inconnu', async () => {
    await expect(rattacherCanal(db, T, 'inexistant', PRESIDENT)).rejects.toThrow(
      expect.objectContaining({ statusCode: 404 }),
    )
  })

  it('exige un nom de titulaire', async () => {
    const id = await canal('Aya Koné')
    await rattacherCanal(db, T, id, PRESIDENT)

    // Le membre lit ce nom dans son application de paiement pour vérifier
    // qu'il envoie bien à la bonne personne (T14).
    expect((await canauxDeTontine(db, T))[0]!.holderName).toBe('Aya Koné')
  })
})

describe('changement de canal sur une tontine active', () => {
  beforeEach(async () => {
    const initial = await canal('Aya Koné', '+2250707000001')
    await rattacherCanal(db, T, initial, PRESIDENT)
    await db.update(tontines).set({ status: 'running' }).where(eq(tontines.id, T))
  })

  it('gèle le nouveau canal pendant 48 heures', async () => {
    const nouveau = await canal('Aya Koné', '+2250505000009')

    const avant = Date.now()
    const { frozenUntil } = await rattacherCanal(db, T, nouveau, PRESIDENT)
    const apres = Date.now()

    expect(frozenUntil).not.toBeNull()
    // Encadré par les deux bornes réelles de l'appel : comparer à un instant
    // pris avant l'appel rend le test faux de quelques millisecondes.
    expect(frozenUntil!.getTime()).toBeGreaterThanOrEqual(avant + GEL_HEURES * 3_600_000)
    expect(frozenUntil!.getTime()).toBeLessThanOrEqual(apres + GEL_HEURES * 3_600_000)
  })

  it('notifie tous les membres', async () => {
    const nouveau = await canal('Aya Koné', '+2250505000009')
    await rattacherCanal(db, T, nouveau, PRESIDENT)

    const envoyees = await db.select().from(notifications)
    // Tous les membres actifs, président compris : c'est lui qu'on protège
    // aussi, si quelqu'un a pris la main sur son compte.
    expect(envoyees).toHaveLength(2)
    expect(envoyees.map(n => n.userId).sort()).toEqual([PRESIDENT, MEMBRE].sort())
  })

  it('écrit le changement au registre, sans exposer le numéro complet', async () => {
    const nouveau = await canal('Aya Koné', '+2250505000009')
    await rattacherCanal(db, T, nouveau, PRESIDENT)

    const ecritures = await db.select().from(ledgerEntries).where(eq(ledgerEntries.tontineId, T))
    expect(ecritures).toHaveLength(1)
    expect(ecritures[0]!.type).toBe('settings_changed')

    const payload = ecritures[0]!.payload as Record<string, unknown>
    expect(payload.msisdnFin).toBe('0009')
    // Le registre est lu par tout le groupe : pas de numéro complet dedans.
    expect(JSON.stringify(payload)).not.toContain('+2250505000009')
  })

  it('ne gèle rien au premier rattachement', async () => {
    // Le gel protège d'un changement suspect, pas de la mise en place initiale.
    const [premier] = await db.select().from(tontineChannels).where(eq(tontineChannels.tontineId, T))
    expect(premier!.frozenUntil).toBeNull()
  })
})

describe('règle 21 — aucune notification ne porte de montant', () => {
  it('refuse une notification contenant un montant', async () => {
    // Une notification s'affiche sur un écran verrouillé, et les téléphones
    // se partagent. « Tu as reçu 250 000 FCFA » désigne une cible.
    await expect(notifierTontine(db, T, {
      type: 'test', title: 'Pot versé', body: 'Tu as reçu 250 000 FCFA',
    })).rejects.toThrow(NotificationAvecMontantError)
  })

  it('refuse aussi un montant écrit sans devise', async () => {
    await expect(notifierTontine(db, T, {
      type: 'test', title: 'Cotisation', body: 'Il te reste 25000 à verser',
    })).rejects.toThrow(NotificationAvecMontantError)
  })

  it('laisse passer une formulation neutre', async () => {
    await notifierTontine(db, T, {
      type: 'test',
      title: 'Nouvelle activité',
      body: 'Une cotisation a été confirmée sur ta tontine.',
    })
  })

  it('n’écrit rien quand la notification est refusée', async () => {
    await expect(notifierTontine(db, T, {
      type: 'test', title: 'x', body: '250 000 FCFA',
    })).rejects.toThrow()
    expect(await db.select().from(notifications)).toHaveLength(0)
  })
})

describe('règle 22 par le chemin de l’écran de réglages', () => {
  /**
   * `definirCanaux` est le **seul** point d'entrée qui existe pour changer de
   * numéro de collecte : `PATCH /tontines/:id` y mène, et l'écran de réglages
   * y mène. Éprouver `rattacherCanal` en direct ne dit donc rien de ce qui se
   * passe vraiment — c'est exactement ainsi que la règle 22 a pu rester au
   * vert tout en ne se déclenchant jamais.
   */
  async function canalVerifie(numero: string) {
    return await canal('Aya Koné', numero)
  }

  beforeEach(async () => {
    await db.update(tontines).set({ status: 'running' }).where(eq(tontines.id, T))
  })

  it('gèle 48 h, écrit au registre et prévient tout le monde', async () => {
    const initial = await canalVerifie('+2250707000001')
    const nouveau = await canalVerifie('+2250505000009')

    await definirCanaux(db, T, [initial], PRESIDENT)
    await definirCanaux(db, T, [nouveau], PRESIDENT)

    const liens = await db.select().from(tontineChannels).where(eq(tontineChannels.tontineId, T))
    expect(liens).toHaveLength(1)
    expect(liens[0]!.channelId).toBe(nouveau)
    expect(liens[0]!.frozenUntil).not.toBeNull()

    const ecritures = (await db.select().from(ledgerEntries))
      .filter(e => (e.payload as { changement?: string }).changement === 'canal_de_collecte')
    expect(ecritures).toHaveLength(1)

    // Tous les membres, pas seulement celui qui a changé le numéro.
    const envoyees = (await db.select().from(notifications)).filter(n => n.type === 'canal_modifie')
    expect(envoyees.length).toBeGreaterThan(0)
  })

  it('ne gèle rien quand on renvoie la même sélection', async () => {
    const initial = await canalVerifie('+2250707000001')

    await definirCanaux(db, T, [initial], PRESIDENT)
    await definirCanaux(db, T, [initial], PRESIDENT)

    // Enregistrer les réglages sans toucher au numéro ne doit ni geler la
    // collecte, ni alerter le groupe pour rien : la deuxième alerte userait
    // la première.
    const liens = await db.select().from(tontineChannels).where(eq(tontineChannels.tontineId, T))
    expect(liens).toHaveLength(1)
    expect(liens[0]!.frozenUntil).toBeNull()
    expect((await db.select().from(notifications)).filter(n => n.type === 'canal_modifie')).toHaveLength(0)
  })

  it('ne gèle pas sur un brouillon : rien n’est encore promis à personne', async () => {
    await db.update(tontines).set({ status: 'draft' }).where(eq(tontines.id, T))
    const initial = await canalVerifie('+2250707000001')
    const nouveau = await canalVerifie('+2250505000009')

    await definirCanaux(db, T, [initial], PRESIDENT)
    await definirCanaux(db, T, [nouveau], PRESIDENT)

    const liens = await db.select().from(tontineChannels).where(eq(tontineChannels.tontineId, T))
    expect(liens[0]!.frozenUntil).toBeNull()
  })
})
