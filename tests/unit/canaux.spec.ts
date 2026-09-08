import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { GEL_HEURES, canauxDeTontine, creerCanal, marquerVerifie, rattacherCanal } from '../../server/services/canaux.ts'
import { definirCanaux } from '../../server/services/tontines.ts'
import { notifierTontine, NotificationAvecMontantError } from '../../server/services/notifications.ts'
import { ledgerEntries, memberships, notifications, tontineChannels, tontines } from '../../server/db/schema.ts'
import { createTestDb, createTestUser } from '../helpers/db.ts'
import type { TestDb } from '../helpers/db.ts'

let db: TestDb
let cleanup: () => void

const PRESIDENT = 'c0000000-0000-4000-8000-000000000001'
const MEMBRE = 'c0000000-0000-4000-8000-000000000002'
const T = 'c0000000-0000-4000-8000-000000000010'

beforeEach(async () => {
  const ctx = createTestDb()
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

function canal(nom = 'Aya Koné', numero = '+2250707000001') {
  return creerCanal(db, PRESIDENT, { provider: 'wave', msisdn: numero, holderName: nom })
}

describe('canaux de collecte — acceptation T09', () => {
  it('refuse de rattacher un canal non vérifié', () => {
    const id = canal()

    // Sans vérification, n'importe qui ferait collecter les cotisations du
    // groupe sur son propre numéro : l'arnaque la plus simple contre une tontine.
    expect(() => rattacherCanal(db, T, id, PRESIDENT)).toThrow(
      expect.objectContaining({ statusCode: 403 }),
    )
  })

  it('accepte le rattachement une fois le numéro vérifié', () => {
    const id = canal()
    marquerVerifie(db, id)

    expect(() => rattacherCanal(db, T, id, PRESIDENT)).not.toThrow()
    expect(canauxDeTontine(db, T)).toHaveLength(1)
  })

  it('exige un nom de titulaire', () => {
    const id = canal('Aya Koné')
    marquerVerifie(db, id)
    rattacherCanal(db, T, id, PRESIDENT)

    // Le membre lit ce nom dans son application de paiement pour vérifier
    // qu'il envoie bien à la bonne personne (T14).
    expect(canauxDeTontine(db, T)[0]!.holderName).toBe('Aya Koné')
  })

  it('n’expose pas un canal non vérifié parmi les canaux de la tontine', () => {
    const verifie = canal('Aya Koné', '+2250707000001')
    marquerVerifie(db, verifie)
    rattacherCanal(db, T, verifie, PRESIDENT)

    const douteux = canal('Inconnu', '+2250707000099')
    db.insert(tontineChannels).values({ tontineId: T, channelId: douteux }).run()

    expect(canauxDeTontine(db, T).map(c => c.id)).toEqual([verifie])
  })
})

describe('changement de canal sur une tontine active', () => {
  beforeEach(() => {
    const initial = canal('Aya Koné', '+2250707000001')
    marquerVerifie(db, initial)
    rattacherCanal(db, T, initial, PRESIDENT)
    db.update(tontines).set({ status: 'running' }).where(eq(tontines.id, T)).run()
  })

  it('gèle le nouveau canal pendant 48 heures', () => {
    const nouveau = canal('Aya Koné', '+2250505000009')
    marquerVerifie(db, nouveau)

    const avant = Date.now()
    const { frozenUntil } = rattacherCanal(db, T, nouveau, PRESIDENT)
    const apres = Date.now()

    expect(frozenUntil).not.toBeNull()
    // Encadré par les deux bornes réelles de l'appel : comparer à un instant
    // pris avant l'appel rend le test faux de quelques millisecondes.
    expect(frozenUntil!.getTime()).toBeGreaterThanOrEqual(avant + GEL_HEURES * 3_600_000)
    expect(frozenUntil!.getTime()).toBeLessThanOrEqual(apres + GEL_HEURES * 3_600_000)
  })

  it('notifie tous les membres', () => {
    const nouveau = canal('Aya Koné', '+2250505000009')
    marquerVerifie(db, nouveau)
    rattacherCanal(db, T, nouveau, PRESIDENT)

    const envoyees = db.select().from(notifications).all()
    // Tous les membres actifs, président compris : c'est lui qu'on protège
    // aussi, si quelqu'un a pris la main sur son compte.
    expect(envoyees).toHaveLength(2)
    expect(envoyees.map(n => n.userId).sort()).toEqual([PRESIDENT, MEMBRE].sort())
  })

  it('écrit le changement au registre, sans exposer le numéro complet', () => {
    const nouveau = canal('Aya Koné', '+2250505000009')
    marquerVerifie(db, nouveau)
    rattacherCanal(db, T, nouveau, PRESIDENT)

    const ecritures = db.select().from(ledgerEntries).where(eq(ledgerEntries.tontineId, T)).all()
    expect(ecritures).toHaveLength(1)
    expect(ecritures[0]!.type).toBe('settings_changed')

    const payload = ecritures[0]!.payload as Record<string, unknown>
    expect(payload.msisdnFin).toBe('0009')
    // Le registre est lu par tout le groupe : pas de numéro complet dedans.
    expect(JSON.stringify(payload)).not.toContain('+2250505000009')
  })

  it('ne gèle rien au premier rattachement', () => {
    // Le gel protège d'un changement suspect, pas de la mise en place initiale.
    const [premier] = db.select().from(tontineChannels).where(eq(tontineChannels.tontineId, T)).all()
    expect(premier!.frozenUntil).toBeNull()
  })
})

describe('règle 21 — aucune notification ne porte de montant', () => {
  it('refuse une notification contenant un montant', () => {
    // Une notification s'affiche sur un écran verrouillé, et les téléphones
    // se partagent. « Tu as reçu 250 000 FCFA » désigne une cible.
    expect(() => notifierTontine(db, T, {
      type: 'test', title: 'Pot versé', body: 'Tu as reçu 250 000 FCFA',
    })).toThrow(NotificationAvecMontantError)
  })

  it('refuse aussi un montant écrit sans devise', () => {
    expect(() => notifierTontine(db, T, {
      type: 'test', title: 'Cotisation', body: 'Il te reste 25000 à verser',
    })).toThrow(NotificationAvecMontantError)
  })

  it('laisse passer une formulation neutre', () => {
    expect(() => notifierTontine(db, T, {
      type: 'test',
      title: 'Nouvelle activité',
      body: 'Une cotisation a été confirmée sur ta tontine.',
    })).not.toThrow()
  })

  it('n’écrit rien quand la notification est refusée', () => {
    expect(() => notifierTontine(db, T, {
      type: 'test', title: 'x', body: '250 000 FCFA',
    })).toThrow()
    expect(db.select().from(notifications).all()).toHaveLength(0)
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
  function canalVerifie(numero: string) {
    const id = canal('Aya Koné', numero)
    marquerVerifie(db, id)
    return id
  }

  beforeEach(() => {
    db.update(tontines).set({ status: 'running' }).where(eq(tontines.id, T)).run()
  })

  it('gèle 48 h, écrit au registre et prévient tout le monde', () => {
    const initial = canalVerifie('+2250707000001')
    const nouveau = canalVerifie('+2250505000009')

    definirCanaux(db, T, [initial], PRESIDENT)
    definirCanaux(db, T, [nouveau], PRESIDENT)

    const liens = db.select().from(tontineChannels).where(eq(tontineChannels.tontineId, T)).all()
    expect(liens).toHaveLength(1)
    expect(liens[0]!.channelId).toBe(nouveau)
    expect(liens[0]!.frozenUntil).not.toBeNull()

    const ecritures = db.select().from(ledgerEntries).all()
      .filter(e => (e.payload as { changement?: string }).changement === 'canal_de_collecte')
    expect(ecritures).toHaveLength(1)

    // Tous les membres, pas seulement celui qui a changé le numéro.
    const envoyees = db.select().from(notifications).all().filter(n => n.type === 'canal_modifie')
    expect(envoyees.length).toBeGreaterThan(0)
  })

  it('ne gèle rien quand on renvoie la même sélection', () => {
    const initial = canalVerifie('+2250707000001')

    definirCanaux(db, T, [initial], PRESIDENT)
    definirCanaux(db, T, [initial], PRESIDENT)

    // Enregistrer les réglages sans toucher au numéro ne doit ni geler la
    // collecte, ni alerter le groupe pour rien : la deuxième alerte userait
    // la première.
    const liens = db.select().from(tontineChannels).where(eq(tontineChannels.tontineId, T)).all()
    expect(liens).toHaveLength(1)
    expect(liens[0]!.frozenUntil).toBeNull()
    expect(db.select().from(notifications).all().filter(n => n.type === 'canal_modifie')).toHaveLength(0)
  })

  it('ne gèle pas sur un brouillon : rien n’est encore promis à personne', () => {
    db.update(tontines).set({ status: 'draft' }).where(eq(tontines.id, T)).run()
    const initial = canalVerifie('+2250707000001')
    const nouveau = canalVerifie('+2250505000009')

    definirCanaux(db, T, [initial], PRESIDENT)
    definirCanaux(db, T, [nouveau], PRESIDENT)

    const liens = db.select().from(tontineChannels).where(eq(tontineChannels.tontineId, T)).all()
    expect(liens[0]!.frozenUntil).toBeNull()
  })
})
