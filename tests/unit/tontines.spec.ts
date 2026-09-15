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
let cleanup: () => void

const U = 'd0000000-0000-4000-8000-000000000001'

beforeEach(async () => {
  const ctx = createTestDb()
  db = ctx.db
  cleanup = ctx.cleanup
  await createTestUser(db, U, '+2250707000001')
})

afterEach(() => cleanup())

function brouillon() {
  return creerBrouillon(db, U, { name: 'Tontine des tantines', access: 'private' })
}

describe('brouillon de tontine', () => {
  it('crée le brouillon et fait du créateur le président', () => {
    const id = brouillon()

    const [t] = db.select().from(tontines).where(eq(tontines.id, id)).all()
    expect(t!.status).toBe('draft')

    const [ms] = db.select().from(memberships).where(eq(memberships.tontineId, id)).all()
    // Le rôle est par tontine : président ici, simple membre ailleurs.
    expect(ms!.role).toBe('president')
    expect(ms!.status).toBe('active')
  })

  it('naît avec un montant à zéro — un brouillon, pas une tontine gratuite', () => {
    const [t] = db.select().from(tontines).where(eq(tontines.id, brouillon())).all()
    expect(t!.shareAmount).toBe(0)
  })

  it('attribue d’emblée une part au président', () => {
    // L'organisateur participe à sa tontine. Sans part, il serait membre sans
    // jamais cotiser ni prendre la main, et le pot attendu serait sous-évalué.
    const id = brouillon()
    expect(totalParts(db, id)).toBe(1)
  })

  it('enregistre les réglages étape par étape', () => {
    const id = brouillon()
    majTontine(db, id, { shareAmount: 25_000, frequency: 'weekly' })

    const [t] = db.select().from(tontines).where(eq(tontines.id, id)).all()
    expect(t!.shareAmount).toBe(25_000)
    expect(t!.frequency).toBe('weekly')
  })
})

describe('publication — draft vers open', () => {
  it('refuse de publier sans montant', () => {
    const id = brouillon()
    const blocages = blocagesPublication(db, id)

    // La liste, pas un simple refus : l'organisateur voit tout ce qui manque.
    expect(blocages.map(b => b.champ)).toContain('shareAmount')
    expect(() => publier(db, id)).toThrow(expect.objectContaining({ statusCode: 403 }))
  })

  it('refuse de publier sans canal de collecte vérifié', () => {
    const id = brouillon()
    majTontine(db, id, { shareAmount: 25_000 })

    expect(blocagesPublication(db, id).map(b => b.champ)).toEqual(['collectionChannelIds'])
  })

  it('publie une fois montant et canal vérifié en place', () => {
    const id = brouillon()
    majTontine(db, id, { shareAmount: 25_000 })

    const canal = creerCanal(db, U, { provider: 'wave', msisdn: '+2250707000001', holderName: 'Aya Koné' })
    marquerVerifie(db, canal)
    definirCanaux(db, id, [canal], U)

    expect(blocagesPublication(db, id)).toEqual([])
    publier(db, id)

    const [t] = db.select().from(tontines).where(eq(tontines.id, id)).all()
    expect(t!.status).toBe('open')
  })

  it('refuse une seconde publication', () => {
    const id = brouillon()
    majTontine(db, id, { shareAmount: 25_000 })
    const canal = creerCanal(db, U, { provider: 'wave', msisdn: '+2250707000001', holderName: 'Aya' })
    marquerVerifie(db, canal)
    definirCanaux(db, id, [canal], U)
    publier(db, id)

    // `open → open` n'est pas dans la table : 409, pas un second passage.
    expect(() => publier(db, id)).toThrow(
      expect.objectContaining({ statusCode: 409, data: { error: expect.objectContaining({ code: 'INVALID_TRANSITION' }) } }),
    )
  })
})

describe('réglages figés une fois la tontine lancée', () => {
  it('refuse de changer un montant en cours de route', () => {
    const id = brouillon()
    db.update(tontines).set({ status: 'running' }).where(eq(tontines.id, id)).run()

    // Changer le montant réécrirait des dus déjà calculés et déjà versés.
    expect(() => majTontine(db, id, { shareAmount: 50_000 })).toThrow(
      expect.objectContaining({ statusCode: 403 }),
    )
  })

  it('laisse modifier la présentation', () => {
    const id = brouillon()
    db.update(tontines).set({ status: 'running' }).where(eq(tontines.id, id)).run()

    expect(() => majTontine(db, id, { description: 'Nouvelle description' })).not.toThrow()
    // L'icône en fait partie : elle ne touche aucun montant ni aucun statut.
    expect(() => majTontine(db, id, { emoji: '🚕' })).not.toThrow()
  })
})

describe('icône de tontine', () => {
  it('est facultative — une tontine sans icône reste valide', () => {
    const [t] = db.select().from(tontines).where(eq(tontines.id, brouillon())).all()
    expect(t!.emoji).toBeNull()
  })

  it('est enregistrée quand le président en choisit une', () => {
    const id = creerBrouillon(db, U, { name: 'Tontine du marché', access: 'private', emoji: '🧺' })

    const [t] = db.select().from(tontines).where(eq(tontines.id, id)).all()
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
  it('compte toutes les parts, bénéficiaire inclus', () => {
    const id = brouillon()
    majTontine(db, id, { shareAmount: 25_000 })

    const [ms] = db.select().from(memberships).where(eq(memberships.tontineId, id)).all()

    // Le président a déjà une part à la création du brouillon : on lui en
    // donne une seconde, comme un membre à double part.
    expect(totalParts(db, id)).toBe(1)
    db.insert(shares).values({
      id: 's2', tontineId: id, membershipId: ms!.id, rotationPosition: 2,
    }).run()

    // Le double part compte deux fois : c'est la source d'erreur n°1 du modèle.
    expect(totalParts(db, id)).toBe(2)
    expect(potAttendu(db, id)).toBe(50_000)
  })
})

describe('démarrage — ce qui bloque, et la date du premier tour', () => {
  /** Une tontine publiée à trois, avec la date de départ donnée. */
  function publieeAvecDate(startDate: string) {
    const id = brouillon()
    majTontine(db, id, { shareAmount: 10_000, frequency: 'monthly', startDate })
    ajouterMembreGere(db, id, { name: 'Koffi', phone: '+2250707000002', shares: 1 })
    ajouterMembreGere(db, id, { name: 'Fatou', phone: '+2250707000003', shares: 1 })
    const canal = creerCanal(db, U, { provider: 'wave', msisdn: '+2250707000001', holderName: 'Aya' })
    marquerVerifie(db, canal)
    definirCanaux(db, id, [canal], U)
    publier(db, id)
    return id
  }

  it('liste le manque de membres', () => {
    const id = brouillon()
    majTontine(db, id, { shareAmount: 10_000, frequency: 'monthly', startDate: '2026-03-01' })
    expect(blocagesDemarrage(db, id, '2026-02-01').map(b => b.champ)).toEqual(['members'])
  })

  it('bloque une date de départ déjà passée, et seulement elle', () => {
    const id = publieeAvecDate('2026-01-15')

    expect(blocagesDemarrage(db, id, '2026-02-01').map(b => b.champ)).toEqual(['startDate'])
    // Le jour même n'est pas passé : on peut démarrer une tontine dont le
    // premier tour est aujourd'hui.
    expect(blocagesDemarrage(db, id, '2026-01-15')).toEqual([])
    expect(blocagesDemarrage(db, id, '2026-01-01')).toEqual([])
  })

  it('ne vérifie le calendrier que si on lui donne la date du jour', () => {
    // Les jeux de données synthétiques démarrent des tontines datées du passé
    // pour rendre les rappels déterministes : sans date de référence, la règle
    // ne s'applique pas. C'est la route qui la passe, toujours.
    const id = publieeAvecDate('2026-01-15')
    expect(blocagesDemarrage(db, id)).toEqual([])
  })

  it('refuse le démarrage sur une date passée, en désignant le champ', () => {
    const id = publieeAvecDate('2026-01-15')

    expect(() => demarrerTontine(db, id, U, { aujourdhui: '2026-02-01' })).toThrow(
      expect.objectContaining({
        statusCode: 422,
        data: { error: expect.objectContaining({ field: 'startDate' }) },
      }),
    )
    const [t] = db.select().from(tontines).where(eq(tontines.id, id)).all()
    expect(t!.status).toBe('open')
  })

  it('démarre quand la date est à venir, et le tour 1 tombe à cette date', () => {
    const id = publieeAvecDate('2026-03-01')
    demarrerTontine(db, id, U, { aujourdhui: '2026-02-01' })

    const [t] = db.select().from(tontines).where(eq(tontines.id, id)).all()
    expect(t!.status).toBe('running')
    expect(toursDe(db, id)[0]!.dueDate).toBe('2026-03-01')
  })

  it('accepte de changer la date tant que la tontine n’a pas démarré', () => {
    const id = publieeAvecDate('2026-01-15')
    majTontine(db, id, { startDate: '2026-03-01' })
    expect(blocagesDemarrage(db, id, '2026-02-01')).toEqual([])

    demarrerTontine(db, id, U, { aujourdhui: '2026-02-01' })
    expect(() => majTontine(db, id, { startDate: '2026-04-01' })).toThrow(
      expect.objectContaining({ statusCode: 403 }),
    )
  })
})

describe('fin de vie — annuler, archiver, supprimer', () => {
  const KOFFI = 'd0000000-0000-4000-8000-000000000002'

  /** Une tontine publiée à trois, dont Koffi a un compte. */
  async function publiee() {
    await createTestUser(db, KOFFI, '+2250707000002')
    const id = brouillon()
    majTontine(db, id, { shareAmount: 10_000, frequency: 'monthly', startDate: '2026-03-01' })
    const koffi = ajouterMembreGere(db, id, { name: 'Koffi', phone: '+2250707000002', shares: 1 })
    db.update(memberships).set({ userId: KOFFI }).where(eq(memberships.id, koffi)).run()
    ajouterMembreGere(db, id, { name: 'Fatou', phone: '+2250707000003', shares: 1 })
    const canal = creerCanal(db, U, { provider: 'wave', msisdn: '+2250707000001', holderName: 'Aya' })
    marquerVerifie(db, canal)
    definirCanaux(db, id, [canal], U)
    publier(db, id)
    return id
  }

  function statut(id: string) {
    return db.select().from(tontines).where(eq(tontines.id, id)).all()[0]?.status
  }

  it('annule une tontine publiée : archivée, écrite au registre, membres prévenus', async () => {
    const id = await publiee()
    annulerTontine(db, id, U, 'Le groupe ne s’est pas réuni')

    expect(statut(id)).toBe('archived')

    const ecriture = db.select().from(ledgerEntries).where(eq(ledgerEntries.tontineId, id)).all()
      .find(e => (e.payload as { changement?: string }).changement === 'annulation')
    expect(ecriture?.payload).toMatchObject({ motif: 'Le groupe ne s’est pas réuni' })

    // Koffi est prévenu, pas le président qui vient d'agir ; aucun montant.
    const prevenus = db.select().from(notifications).all()
    expect(prevenus.map(n => n.userId)).toEqual([KOFFI])
    expect(prevenus[0]!.body).not.toMatch(/\d{4}/)
  })

  it('refuse d’annuler une tontine en cours : elle va au bout de son cycle', async () => {
    const id = await publiee()
    demarrerTontine(db, id, U)
    expect(() => annulerTontine(db, id, U, 'Changement d’avis')).toThrow(
      expect.objectContaining({ statusCode: 409 }),
    )
    expect(statut(id)).toBe('running')
  })

  it('refuse d’annuler un brouillon : il se supprime', () => {
    const id = brouillon()
    expect(() => annulerTontine(db, id, U, 'Erreur de saisie')).toThrow(
      expect.objectContaining({ statusCode: 409 }),
    )
  })

  it('supprime un brouillon, et tout ce qui en dépend', () => {
    const id = brouillon()
    supprimerBrouillon(db, id)

    expect(statut(id)).toBeUndefined()
    expect(db.select().from(memberships).where(eq(memberships.tontineId, id)).all()).toHaveLength(0)
    expect(db.select().from(shares).where(eq(shares.tontineId, id)).all()).toHaveLength(0)
  })

  it('ne supprime jamais une tontine publiée', async () => {
    const id = await publiee()
    expect(() => supprimerBrouillon(db, id)).toThrow(expect.objectContaining({ statusCode: 409 }))
    expect(statut(id)).toBe('open')
  })

  it('archive une tontine terminée, et seulement elle', async () => {
    const id = await publiee()
    expect(() => archiverTontine(db, id, U)).toThrow(expect.objectContaining({ statusCode: 409 }))

    db.update(tontines).set({ status: 'closed' }).where(eq(tontines.id, id)).run()
    archiverTontine(db, id, U)

    expect(statut(id)).toBe('archived')
    const ecriture = db.select().from(ledgerEntries).where(eq(ledgerEntries.tontineId, id)).all()
      .find(e => (e.payload as { changement?: string }).changement === 'archivage')
    expect(ecriture).toBeDefined()
  })
})
