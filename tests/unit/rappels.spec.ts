import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  JOURS_DE_RAPPEL, envoyerRappels, estEnSilence, minuteDuJour, relancesWhatsApp,
} from '../../server/services/rappels.ts'
import { ajouterMembreGere } from '../../server/services/membres.ts'
import { creerCanal } from '../../server/services/canaux.ts'
import { creerBrouillon, definirCanaux, majTontine, publier } from '../../server/services/tontines.ts'
import { demarrerTontine } from '../../server/services/tours.ts'
import { memberships, notificationPreferences, notifications } from '../../server/db/schema.ts'
import { createTestDb, createTestUser } from '../helpers/db.ts'
import type { TestDb } from '../helpers/db.ts'

let db: TestDb
let cleanup: () => Promise<void>
let T: string

const PRESIDENT = 'c2000000-0000-4000-8000-000000000001'
const MEMBRE = 'c2000000-0000-4000-8000-000000000002'
const AUTRE = 'c2000000-0000-4000-8000-000000000003'

/** Échéance du tour 1 : 15 janvier 2026. */
const ECHEANCE = '2026-01-15'
const A = (jour: string, heure = 8) => new Date(`${jour}T${String(heure).padStart(2, '0')}:00:00`)

beforeEach(async () => {
  const ctx = await createTestDb()
  db = ctx.db
  cleanup = ctx.cleanup

  await createTestUser(db, PRESIDENT, '+2250707001111')
  await createTestUser(db, MEMBRE, '+2250707002222')
  await createTestUser(db, AUTRE, '+2250707004444')

  T = (await creerBrouillon(db, PRESIDENT, { name: 'Tontine des tantines', access: 'private' }))
  await majTontine(db, T, { shareAmount: 25_000, frequency: 'monthly', startDate: ECHEANCE })
  // Le président ne cotise pas, il n'est donc jamais relancé. Koffi a deux
  // parts : on vérifiera qu'il n'est relancé qu'une fois. Yao a un compte,
  // Fatou n'en a pas.
  await ajouterMembreGere(db, T, { name: 'Koffi', phone: '+2250707002222', shares: 2 })
  await ajouterMembreGere(db, T, { name: 'Fatou', phone: '+2250707003333', shares: 1 })
  await ajouterMembreGere(db, T, { name: 'Yao', phone: '+2250707004444', shares: 1 })

  const canal = await creerCanal(db, PRESIDENT, { provider: 'wave', msisdn: '+2250707001111', holderName: 'Aya' })
  await definirCanaux(db, T, [canal], PRESIDENT)
  await publier(db, T)
  await demarrerTontine(db, T, PRESIDENT)

  const koffi = (await db.select().from(memberships)).find(m => m.managedName === 'Koffi')!
  await db.update(memberships).set({ userId: MEMBRE }).where(eq(memberships.id, koffi.id))
  const yao = (await db.select().from(memberships)).find(m => m.managedName === 'Yao')!
  await db.update(memberships).set({ userId: AUTRE }).where(eq(memberships.id, yao.id))
})

afterEach(() => cleanup())

describe('plages de silence', () => {
  it('respecte une plage ordinaire', () => {
    expect(estEnSilence({ start: 13 * 60, end: 15 * 60 }, 14 * 60)).toBe(true)
    expect(estEnSilence({ start: 13 * 60, end: 15 * 60 }, 12 * 60)).toBe(false)
    expect(estEnSilence({ start: 13 * 60, end: 15 * 60 }, 15 * 60)).toBe(false)
  })

  it('gère une plage qui traverse minuit', () => {
    // « 21 h à 7 h » est le cas courant. Une comparaison naïve donnerait
    // toujours faux, et les rappels partiraient en pleine nuit.
    const nuit = { start: 21 * 60, end: 7 * 60 }

    expect(estEnSilence(nuit, 23 * 60)).toBe(true)
    expect(estEnSilence(nuit, 2 * 60)).toBe(true)
    expect(estEnSilence(nuit, 6 * 60 + 59)).toBe(true)
    expect(estEnSilence(nuit, 8 * 60)).toBe(false)
    expect(estEnSilence(nuit, 20 * 60)).toBe(false)
  })

  it('ne fait rien taire quand aucune plage n’est réglée', () => {
    expect(estEnSilence({ start: null, end: null }, 3 * 60)).toBe(false)
    expect(estEnSilence({ start: 600, end: null }, 3 * 60)).toBe(false)
  })

  it('convertit correctement l’heure en minutes', () => {
    expect(minuteDuJour(new Date('2026-01-15T21:30:00'))).toBe(21 * 60 + 30)
    expect(minuteDuJour(new Date('2026-01-15T00:00:00'))).toBe(0)
  })
})

describe('rappels de cotisation', () => {
  it('relance à J-2 et le jour même, pas les autres jours', async () => {
    expect(JOURS_DE_RAPPEL).toEqual([2, 0])

    // Deux destinataires et non trois : Fatou est une membre gérée, sans
    // compte à notifier. C'est voulu — elle est jointe par la relance
    // WhatsApp, qui est exactement le recours prévu pour elle.
    expect(await envoyerRappels(db, A('2026-01-13'))).toHaveLength(2)
    await db.delete(notifications)

    expect(await envoyerRappels(db, A('2026-01-15'))).toHaveLength(2)
    await db.delete(notifications)

    // Ni J-3, ni J-1, ni après : deux rappels suffisent, au-delà c'est du
    // harcèlement et le membre coupe les notifications.
    expect(await envoyerRappels(db, A('2026-01-12'))).toHaveLength(0)
    expect(await envoyerRappels(db, A('2026-01-14'))).toHaveLength(0)
    expect(await envoyerRappels(db, A('2026-01-16'))).toHaveLength(0)
  })

  it('ne notifie pas un membre géré, qui n’a pas de compte', async () => {
    const envoyes = await envoyerRappels(db, A('2026-01-15'))
    const destinataires = new Set(envoyes.map(e => e.userId))

    expect(destinataires).toEqual(new Set([MEMBRE, AUTRE]))
    // Mais elle figure bien dans les relances WhatsApp.
    expect((await relancesWhatsApp(db, T)).map(r => r.nom)).toContain('Fatou')
  })

  it('ne relance qu’une fois un membre à double part', async () => {
    const envoyes = await envoyerRappels(db, A('2026-01-15'))

    // Deux notifications identiques à la seconde près donnent l'impression
    // d'un bug.
    expect(envoyes.filter(e => e.userId === MEMBRE)).toHaveLength(1)
  })

  it('ne relance pas pendant la plage de silence du membre', async () => {
    await db.insert(notificationPreferences).values({
      id: 'pref-1',
      userId: MEMBRE,
      tontineId: null,
      quietHoursStart: 21 * 60,
      quietHoursEnd: 7 * 60,
    })

    const laNuit = await envoyerRappels(db, A('2026-01-15', 23))
    expect(laNuit.some(e => e.userId === MEMBRE)).toBe(false)

    // Et les autres membres, eux, sont bien relancés.
    expect(laNuit.some(e => e.userId === AUTRE)).toBe(true)
  })

  it('respecte le refus des rappels', async () => {
    await db.insert(notificationPreferences).values({
      id: 'pref-2', userId: MEMBRE, tontineId: null, remindersEnabled: false,
    })

    expect((await envoyerRappels(db, A('2026-01-15'))).some(e => e.userId === MEMBRE)).toBe(false)
  })

  it('laisse le réglage par tontine l’emporter sur le réglage général', async () => {
    await db.insert(notificationPreferences).values([
      { id: 'pref-g', userId: MEMBRE, tontineId: null, remindersEnabled: false },
      { id: 'pref-t', userId: MEMBRE, tontineId: T, remindersEnabled: true },
    ])

    expect((await envoyerRappels(db, A('2026-01-15'))).some(e => e.userId === MEMBRE)).toBe(true)
  })

  it('n’écrit aucun montant dans les rappels', async () => {
    await envoyerRappels(db, A('2026-01-15'))

    // Règle 21, vérifiée sur ce qui est réellement écrit en base.
    for (const n of await db.select().from(notifications)) {
      expect(`${n.title} ${n.body}`).not.toMatch(/FCFA|\d{4}/)
    }
  })
})

describe('relances WhatsApp — l’envoi reste manuel', () => {
  it('produit un lien wa.me pré-rempli par retardataire', async () => {
    const relances = await relancesWhatsApp(db, T)

    // Trois cotisants, dont un à double part : trois relances, pas quatre.
    expect(relances).toHaveLength(3)

    const koffi = relances.find(r => r.nom === 'Koffi')!
    expect(koffi.url).toContain('https://wa.me/2250707002222')
    expect(decodeURIComponent(koffi.url!)).toContain('Tontine des tantines')
    expect(decodeURIComponent(koffi.url!)).toContain('Bonjour Koffi')
  })

  it('n’écrit aucun montant dans le message', async () => {
    // Le message part sur WhatsApp, qui affiche un aperçu sur l'écran
    // verrouillé — exactement comme une notification.
    for (const relance of await relancesWhatsApp(db, T)) {
      expect(relance.message).not.toMatch(/FCFA|\d{4}/)
    }
  })

  it('n’invente pas de lien pour un membre sans numéro', async () => {
    const gere = (await db.select().from(memberships)).find(m => m.managedName === 'Fatou')!
    await db.update(memberships).set({ managedPhone: null }).where(eq(memberships.id, gere.id))

    const fatou = (await relancesWhatsApp(db, T)).find(r => r.nom === 'Fatou')!
    expect(fatou.url).toBeNull()
    expect(fatou.msisdn).toBeNull()
  })
})
