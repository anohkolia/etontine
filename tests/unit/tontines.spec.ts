import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { creerCanal, marquerVerifie } from '../../server/services/canaux.ts'
import {
  annulerTontine, archiverTontine, blocagesPublication, creerBrouillon, majTontine, definirCanaux,
  potAttendu, publier, supprimerBrouillon, totalParts,
} from '../../server/services/tontines.ts'
import { ajouterMembreGere } from '../../server/services/membres.ts'
import { blocagesDemarrage, demarrerTontine, toursDe } from '../../server/services/tours.ts'
import { ledgerEntries, memberships, notifications, shares, tontines } from '../../server/db/schema.ts'
import { tontineEmoji } from '../../shared/schemas/index.ts'
import { TONTINE_EMOJIS } from '../../shared/constants/tontine.ts'
import { createTestDb, createTestUser } from '../helpers/db.ts'
import type { TestDb } from '../helpers/db.ts'

let db: TestDb
let cleanup: () => Promise<void>

const U = 'd0000000-0000-4000-8000-000000000001'

beforeEach(async () => {
  const ctx = await createTestDb()
  db = ctx.db
  cleanup = ctx.cleanup
  await createTestUser(db, U, '+2250707000001')
})

afterEach(() => cleanup())

async function brouillon() {
  return await creerBrouillon(db, U, { name: 'Tontine des tantines', access: 'private' })
}

describe('brouillon de tontine', () => {
  it('crée le brouillon et fait du créateur le président', async () => {
    const id = await brouillon()

    const [t] = await db.select().from(tontines).where(eq(tontines.id, id))
    expect(t!.status).toBe('draft')

    const [ms] = await db.select().from(memberships).where(eq(memberships.tontineId, id))
    // Le rôle est par tontine : président ici, simple membre ailleurs.
    expect(ms!.role).toBe('president')
    expect(ms!.status).toBe('active')
  })

  it('naît avec un montant à zéro — un brouillon, pas une tontine gratuite', async () => {
    const [t] = await db.select().from(tontines).where(eq(tontines.id, await brouillon()))
    expect(t!.shareAmount).toBe(0)
  })

  it('attribue d’emblée une part au président', async () => {
    // L'organisateur participe à sa tontine. Sans part, il serait membre sans
    // jamais cotiser ni prendre la main, et le pot attendu serait sous-évalué.
    const id = await brouillon()
    expect(await totalParts(db, id)).toBe(1)
  })

  it('enregistre les réglages étape par étape', async () => {
    const id = await brouillon()
    await majTontine(db, id, { shareAmount: 25_000, frequency: 'weekly' })

    const [t] = await db.select().from(tontines).where(eq(tontines.id, id))
    expect(t!.shareAmount).toBe(25_000)
    expect(t!.frequency).toBe('weekly')
  })
})

describe('publication — draft vers open', () => {
  it('refuse de publier sans montant', async () => {
    const id = await brouillon()
    const blocages = await blocagesPublication(db, id)

    // La liste, pas un simple refus : l'organisateur voit tout ce qui manque.
    expect(blocages.map(b => b.champ)).toContain('shareAmount')
    await expect(publier(db, id)).rejects.toThrow(expect.objectContaining({ statusCode: 403 }))
  })

  it('refuse de publier sans canal de collecte vérifié', async () => {
    const id = await brouillon()
    await majTontine(db, id, { shareAmount: 25_000 })

    expect((await blocagesPublication(db, id)).map(b => b.champ)).toEqual(['collectionChannelIds'])
  })

  it('publie une fois montant et canal vérifié en place', async () => {
    const id = await brouillon()
    await majTontine(db, id, { shareAmount: 25_000 })

    const canal = await creerCanal(db, U, { provider: 'wave', msisdn: '+2250707000001', holderName: 'Aya Koné' })
    await marquerVerifie(db, canal)
    await definirCanaux(db, id, [canal], U)

    expect(await blocagesPublication(db, id)).toEqual([])
    await publier(db, id)

    const [t] = await db.select().from(tontines).where(eq(tontines.id, id))
    expect(t!.status).toBe('open')
  })

  it('refuse une seconde publication', async () => {
    const id = await brouillon()
    await majTontine(db, id, { shareAmount: 25_000 })
    const canal = await creerCanal(db, U, { provider: 'wave', msisdn: '+2250707000001', holderName: 'Aya' })
    await marquerVerifie(db, canal)
    await definirCanaux(db, id, [canal], U)
    await publier(db, id)

    // `open → open` n'est pas dans la table : 409, pas un second passage.
    await expect(publier(db, id)).rejects.toThrow(
      expect.objectContaining({ statusCode: 409, data: { error: expect.objectContaining({ code: 'INVALID_TRANSITION' }) } }),
    )
  })
})

describe('réglages figés une fois la tontine lancée', () => {
  it('refuse de changer un montant en cours de route', async () => {
    const id = await brouillon()
    await db.update(tontines).set({ status: 'running' }).where(eq(tontines.id, id))

    // Changer le montant réécrirait des dus déjà calculés et déjà versés.
    await expect(majTontine(db, id, { shareAmount: 50_000 })).rejects.toThrow(
      expect.objectContaining({ statusCode: 403 }),
    )
  })

  it('laisse modifier la présentation', async () => {
    const id = await brouillon()
    await db.update(tontines).set({ status: 'running' }).where(eq(tontines.id, id))

    await majTontine(db, id, { description: 'Nouvelle description' })
    // L'icône en fait partie : elle ne touche aucun montant ni aucun statut.
    await majTontine(db, id, { emoji: '🚕' })
  })
})

describe('icône de tontine', () => {
  it('est facultative — une tontine sans icône reste valide', async () => {
    const [t] = await db.select().from(tontines).where(eq(tontines.id, await brouillon()))
    expect(t!.emoji).toBeNull()
  })

  it('est enregistrée quand le président en choisit une', async () => {
    const id = await creerBrouillon(db, U, { name: 'Tontine du marché', access: 'private', emoji: '🧺' })

    const [t] = await db.select().from(tontines).where(eq(tontines.id, id))
    expect(t!.emoji).toBe('🧺')
  })

  it('n’accepte que les valeurs de la liste fermée', () => {
    // Le champ n'est pas du texte libre : un caractère de contrôle
    // bidirectionnel ou une chaîne de trois cents octets casserait toutes les
    // listes qui l'affichent. Le schéma le refuse avant la base.
    expect(tontineEmoji.safeParse('🧺').success).toBe(true)
    expect(tontineEmoji.safeParse('💣').success).toBe(false)
    expect(tontineEmoji.safeParse('🧺🧺').success).toBe(false)
    expect(tontineEmoji.safeParse('\u202E').success).toBe(false)
  })

  it('propose exactement ce que le serveur accepte', () => {
    // Deux listes qui divergent donneraient un wizard capable de proposer une
    // icône que l'API refuse — panne silencieuse, au dernier écran du wizard.
    expect([...tontineEmoji.options]).toEqual([...TONTINE_EMOJIS])
  })
})

describe('calcul du pot — règle n°1', () => {
  it('compte toutes les parts, bénéficiaire inclus', async () => {
    const id = await brouillon()
    await majTontine(db, id, { shareAmount: 25_000 })

    const [ms] = await db.select().from(memberships).where(eq(memberships.tontineId, id))

    // Le président a déjà une part à la création du brouillon : on lui en
    // donne une seconde, comme un membre à double part.
    expect(await totalParts(db, id)).toBe(1)
    await db.insert(shares).values({
      id: 's2', tontineId: id, membershipId: ms!.id, rotationPosition: 2,
    })

    // Le double part compte deux fois : c'est la source d'erreur n°1 du modèle.
    expect(await totalParts(db, id)).toBe(2)
    expect(await potAttendu(db, id)).toBe(50_000)
  })
})

describe('démarrage — ce qui bloque, et la date du premier tour', () => {
  /** Une tontine publiée à trois, avec la date de départ donnée. */
  async function publieeAvecDate(startDate: string) {
    const id = await brouillon()
    await majTontine(db, id, { shareAmount: 10_000, frequency: 'monthly', startDate })
    await ajouterMembreGere(db, id, { name: 'Koffi', phone: '+2250707000002', shares: 1 })
    await ajouterMembreGere(db, id, { name: 'Fatou', phone: '+2250707000003', shares: 1 })
    const canal = await creerCanal(db, U, { provider: 'wave', msisdn: '+2250707000001', holderName: 'Aya' })
    await marquerVerifie(db, canal)
    await definirCanaux(db, id, [canal], U)
    await publier(db, id)
    return id
  }

  it('liste le manque de membres', async () => {
    const id = await brouillon()
    await majTontine(db, id, { shareAmount: 10_000, frequency: 'monthly', startDate: '2026-03-01' })
    expect((await blocagesDemarrage(db, id, '2026-02-01')).map(b => b.champ)).toEqual(['members'])
  })

  it('bloque une date de départ déjà passée, et seulement elle', async () => {
    const id = await publieeAvecDate('2026-01-15')

    expect((await blocagesDemarrage(db, id, '2026-02-01')).map(b => b.champ)).toEqual(['startDate'])
    // Le jour même n'est pas passé : on peut démarrer une tontine dont le
    // premier tour est aujourd'hui.
    expect(await blocagesDemarrage(db, id, '2026-01-15')).toEqual([])
    expect(await blocagesDemarrage(db, id, '2026-01-01')).toEqual([])
  })

  it('ne vérifie le calendrier que si on lui donne la date du jour', async () => {
    // Les jeux de données synthétiques démarrent des tontines datées du passé
    // pour rendre les rappels déterministes : sans date de référence, la règle
    // ne s'applique pas. C'est la route qui la passe, toujours.
    const id = await publieeAvecDate('2026-01-15')
    expect(await blocagesDemarrage(db, id)).toEqual([])
  })

  it('refuse le démarrage sur une date passée, en désignant le champ', async () => {
    const id = await publieeAvecDate('2026-01-15')

    await expect(demarrerTontine(db, id, U, { aujourdhui: '2026-02-01' })).rejects.toThrow(
      expect.objectContaining({
        statusCode: 422,
        data: { error: expect.objectContaining({ field: 'startDate' }) },
      }),
    )
    const [t] = await db.select().from(tontines).where(eq(tontines.id, id))
    expect(t!.status).toBe('open')
  })

  it('démarre quand la date est à venir, et le tour 1 tombe à cette date', async () => {
    const id = await publieeAvecDate('2026-03-01')
    await demarrerTontine(db, id, U, { aujourdhui: '2026-02-01' })

    const [t] = await db.select().from(tontines).where(eq(tontines.id, id))
    expect(t!.status).toBe('running')
    expect((await toursDe(db, id))[0]!.dueDate).toBe('2026-03-01')
  })

  it('accepte de changer la date tant que la tontine n’a pas démarré', async () => {
    const id = await publieeAvecDate('2026-01-15')
    await majTontine(db, id, { startDate: '2026-03-01' })
    expect(await blocagesDemarrage(db, id, '2026-02-01')).toEqual([])

    await demarrerTontine(db, id, U, { aujourdhui: '2026-02-01' })
    await expect(majTontine(db, id, { startDate: '2026-04-01' })).rejects.toThrow(
      expect.objectContaining({ statusCode: 403 }),
    )
  })
})

describe('fin de vie — annuler, archiver, supprimer', () => {
  const KOFFI = 'd0000000-0000-4000-8000-000000000002'

  /** Une tontine publiée à trois, dont Koffi a un compte. */
  async function publiee() {
    await createTestUser(db, KOFFI, '+2250707000002')
    const id = await brouillon()
    await majTontine(db, id, { shareAmount: 10_000, frequency: 'monthly', startDate: '2026-03-01' })
    const koffi = await ajouterMembreGere(db, id, { name: 'Koffi', phone: '+2250707000002', shares: 1 })
    await db.update(memberships).set({ userId: KOFFI }).where(eq(memberships.id, koffi))
    await ajouterMembreGere(db, id, { name: 'Fatou', phone: '+2250707000003', shares: 1 })
    const canal = await creerCanal(db, U, { provider: 'wave', msisdn: '+2250707000001', holderName: 'Aya' })
    await marquerVerifie(db, canal)
    await definirCanaux(db, id, [canal], U)
    await publier(db, id)
    return id
  }

  async function statut(id: string) {
    return (await db.select().from(tontines).where(eq(tontines.id, id)))[0]?.status
  }

  it('annule une tontine publiée : archivée, écrite au registre, membres prévenus', async () => {
    const id = await publiee()
    await annulerTontine(db, id, U, 'Le groupe ne s’est pas réuni')

    expect(await statut(id)).toBe('archived')

    const ecriture = (await db.select().from(ledgerEntries).where(eq(ledgerEntries.tontineId, id)))
      .find(e => (e.payload as { changement?: string }).changement === 'annulation')
    expect(ecriture?.payload).toMatchObject({ motif: 'Le groupe ne s’est pas réuni' })

    // Koffi est prévenu, pas le président qui vient d'agir ; aucun montant.
    const prevenus = await db.select().from(notifications)
    expect(prevenus.map(n => n.userId)).toEqual([KOFFI])
    expect(prevenus[0]!.body).not.toMatch(/\d{4}/)
  })

  it('refuse d’annuler une tontine en cours : elle va au bout de son cycle', async () => {
    const id = await publiee()
    await demarrerTontine(db, id, U)
    await expect(annulerTontine(db, id, U, 'Changement d’avis')).rejects.toThrow(
      expect.objectContaining({ statusCode: 409 }),
    )
    expect(await statut(id)).toBe('running')
  })

  it('refuse d’annuler un brouillon : il se supprime', async () => {
    const id = await brouillon()
    await expect(annulerTontine(db, id, U, 'Erreur de saisie')).rejects.toThrow(
      expect.objectContaining({ statusCode: 409 }),
    )
  })

  it('supprime un brouillon, et tout ce qui en dépend', async () => {
    const id = await brouillon()
    await supprimerBrouillon(db, id)

    expect(await statut(id)).toBeUndefined()
    expect(await db.select().from(memberships).where(eq(memberships.tontineId, id))).toHaveLength(0)
    expect(await db.select().from(shares).where(eq(shares.tontineId, id))).toHaveLength(0)
  })

  it('ne supprime jamais une tontine publiée', async () => {
    const id = await publiee()
    await expect(supprimerBrouillon(db, id)).rejects.toThrow(expect.objectContaining({ statusCode: 409 }))
    expect(await statut(id)).toBe('open')
  })

  it('archive une tontine terminée, et seulement elle', async () => {
    const id = await publiee()
    await expect(archiverTontine(db, id, U)).rejects.toThrow(expect.objectContaining({ statusCode: 409 }))

    await db.update(tontines).set({ status: 'closed' }).where(eq(tontines.id, id))
    await archiverTontine(db, id, U)

    expect(await statut(id)).toBe('archived')
    const ecriture = (await db.select().from(ledgerEntries).where(eq(ledgerEntries.tontineId, id)))
      .find(e => (e.payload as { changement?: string }).changement === 'archivage')
    expect(ecriture).toBeDefined()
  })
})
