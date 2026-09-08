import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  accepterInvitation, apercuInvitation, approuverAdhesion, creerInvitation, refuserAdhesion,
} from '../../server/services/invitations.ts'
import { ajouterMembreGere, attribuerParts } from '../../server/services/membres.ts'
import { creerBrouillon, majTontine } from '../../server/services/tontines.ts'
import { useEngagement } from '../../app/composables/useEngagement.ts'
import { useMoney } from '../../app/composables/useMoney.ts'
import { ledgerEntries, memberships, shares, tontines } from '../../server/db/schema.ts'
import { createTestDb, createTestUser } from '../helpers/db.ts'
import type { TestDb } from '../helpers/db.ts'

let db: TestDb
let cleanup: () => void
let T: string

const PRESIDENT = 'f0000000-0000-4000-8000-000000000001'
const ARRIVANT = 'f0000000-0000-4000-8000-000000000002'
const NUMERO_GERE = '+2250707000009'

beforeEach(async () => {
  const ctx = createTestDb()
  db = ctx.db
  cleanup = ctx.cleanup

  await createTestUser(db, PRESIDENT, '+2250707000001')
  await db.update((await import('../../server/db/schema.ts')).users)
    .set({ firstName: 'Aya', lastName: 'Koné' })
    .where(eq((await import('../../server/db/schema.ts')).users.id, PRESIDENT))

  T = creerBrouillon(db, PRESIDENT, { name: 'Tontine des tantines', access: 'private' })
  majTontine(db, T, { shareAmount: 25_000, frequency: 'monthly', locality: 'Abobo' })

  const [ms] = db.select().from(memberships).where(eq(memberships.tontineId, T)).all()
  attribuerParts(db, T, ms!.id, 1)
})

afterEach(() => cleanup())

describe('aperçu public — acceptation T12', () => {
  it('montre nom, président, montant, fréquence et nombre de membres', () => {
    const { token } = creerInvitation(db, T, PRESIDENT)
    const apercu = apercuInvitation(db, token)

    // Un visiteur non connecté doit pouvoir juger avant de créer un compte.
    expect(apercu.name).toBe('Tontine des tantines')
    expect(apercu.presidentName).toBe('Aya Koné')
    expect(apercu.shareAmount).toBe(25_000)
    expect(apercu.frequency).toBe('monthly')
    expect(apercu.memberCount).toBe(1)
  })

  it('n’expose ni la liste des membres, ni leurs numéros', () => {
    ajouterMembreGere(db, T, { name: 'Yao Brou', phone: NUMERO_GERE, shares: 1 })
    const { token } = creerInvitation(db, T, PRESIDENT)
    const texte = JSON.stringify(apercuInvitation(db, token))

    // Un lien qui fuite ne doit pas livrer le carnet d'adresses du groupe.
    expect(texte).not.toContain(NUMERO_GERE)
    expect(texte).not.toContain('Yao Brou')
  })

  it('refuse un jeton inconnu, expiré ou épuisé', async () => {
    expect(() => apercuInvitation(db, 'inexistant')).toThrow(
      expect.objectContaining({ statusCode: 404 }),
    )

    const { token } = creerInvitation(db, T, PRESIDENT, 1)
    await createTestUser(db, ARRIVANT, '+2250707000002')
    accepterInvitation(db, token, ARRIVANT)

    // Le lien à usage unique s'épuise : le second visiteur ne voit plus rien.
    expect(() => apercuInvitation(db, token)).toThrow(
      expect.objectContaining({ statusCode: 404 }),
    )
  })
})

describe('adhésion', () => {
  async function nouvelArrivant(phone: string) {
    await createTestUser(db, ARRIVANT, phone)
    return ARRIVANT
  }

  it('place un nouvel arrivant en attente d’accord', async () => {
    await nouvelArrivant('+2250707000002')
    const { token } = creerInvitation(db, T, PRESIDENT)

    const resultat = accepterInvitation(db, token, ARRIVANT)
    expect(resultat.status).toBe('pending_approval')
    expect(resultat.rattache).toBe(false)
  })

  it('rattache un membre géré sans dupliquer son historique', async () => {
    // Le bureau l'a saisi à la main ; il a déjà des cotisations à son compte.
    const membershipId = ajouterMembreGere(db, T, {
      name: 'Yao Brou', phone: NUMERO_GERE, shares: 2,
    })

    await createTestUser(db, ARRIVANT, NUMERO_GERE)
    const { token } = creerInvitation(db, T, PRESIDENT)

    const resultat = accepterInvitation(db, token, ARRIVANT)

    // Acceptation T12 : rattaché, pas dupliqué.
    expect(resultat.rattache).toBe(true)
    expect(resultat.membershipId).toBe(membershipId)

    const adhesions = db.select().from(memberships).where(eq(memberships.tontineId, T)).all()
    expect(adhesions.filter(m => m.managedPhone === NUMERO_GERE)).toHaveLength(1)

    // Ses deux parts sont conservées : les dédoubler fausserait le pot du groupe.
    expect(db.select().from(shares).where(eq(shares.membershipId, membershipId)).all()).toHaveLength(2)
  })

  it('rapproche sur le numéro, pas sur le nom', async () => {
    // Deux membres peuvent porter le même nom, jamais le même numéro.
    ajouterMembreGere(db, T, { name: 'Yao Brou', phone: NUMERO_GERE, shares: 1 })
    await createTestUser(db, ARRIVANT, '+2250707000077')

    const { token } = creerInvitation(db, T, PRESIDENT)
    const resultat = accepterInvitation(db, token, ARRIVANT)

    expect(resultat.rattache).toBe(false)
    expect(db.select().from(memberships).where(eq(memberships.tontineId, T)).all()).toHaveLength(3)
  })

  it('reste sans effet si l’on accepte deux fois', async () => {
    await createTestUser(db, ARRIVANT, '+2250707000002')
    const { token } = creerInvitation(db, T, PRESIDENT)

    const premier = accepterInvitation(db, token, ARRIVANT)
    const second = accepterInvitation(db, token, ARRIVANT)

    expect(second.membershipId).toBe(premier.membershipId)
    expect(db.select().from(memberships).where(eq(memberships.tontineId, T)).all()).toHaveLength(2)
  })

  it('inscrit le rattachement au registre', async () => {
    ajouterMembreGere(db, T, { name: 'Yao Brou', phone: NUMERO_GERE, shares: 1 })
    await createTestUser(db, ARRIVANT, NUMERO_GERE)

    const { token } = creerInvitation(db, T, PRESIDENT)
    accepterInvitation(db, token, ARRIVANT)

    const ecritures = db.select().from(ledgerEntries).where(eq(ledgerEntries.type, 'member_joined')).all()
    expect(ecritures).toHaveLength(1)
    expect((ecritures[0]!.payload as { rattachement: boolean }).rattachement).toBe(true)
  })
})

describe('phrase d’engagement — acceptation T12', () => {
  const { phrase } = useEngagement()
  const { format } = useMoney()

  it('se génère à partir des réglages réels', () => {
    const rendu = phrase(10_000, 12, 'monthly')

    expect(rendu).toBe(
      `Tu t’engages à verser ${format(10_000)} chaque mois pendant 12 mois, `
      + `soit ${format(120_000)} au total. Tu recevras ${format(120_000)} à ton tour.`,
    )
  })

  it('accorde la cadence à la fréquence', () => {
    expect(phrase(5_000, 8, 'weekly')).toContain('chaque semaine pendant 8 semaines')
    expect(phrase(5_000, 8, 'daily')).toContain('chaque jour pendant 8 jours')
    expect(phrase(5_000, 8, 'biweekly')).toContain('tous les quinze jours pendant 8 quinzaines')
  })

  it('dit le total, pas seulement la mensualité', () => {
    // C'est le chiffre que personne ne calcule avant de dire oui, et c'est
    // celui qui fait abandonner au troisième tour.
    expect(phrase(25_000, 7, 'monthly')).toContain(format(175_000))
  })

  it('ne promet rien tant que les parts ne sont pas attribuées', () => {
    expect(phrase(25_000, 0, 'monthly')).toBe('')
  })
})

describe('accord du président sur une adhésion — le lien menait dans le vide', () => {
  async function demandeEnAttente() {
    await createTestUser(db, ARRIVANT, '+2250707000002')
    const { token } = creerInvitation(db, T, PRESIDENT)
    return accepterInvitation(db, token, ARRIVANT).membershipId
  }

  it('rend le membre actif **et** lui attribue sa part', async () => {
    const membershipId = await demandeEnAttente()

    // Sans la part, l'approbation ne servait à rien : le membre n'entrait dans
    // aucune rotation, ne cotisait jamais et ne prenait jamais la main.
    expect(db.select().from(shares).where(eq(shares.membershipId, membershipId)).all()).toHaveLength(0)

    approuverAdhesion(db, membershipId, PRESIDENT)

    const [m] = db.select().from(memberships).where(eq(memberships.id, membershipId)).all()
    expect(m!.status).toBe('active')
    expect(db.select().from(shares).where(eq(shares.membershipId, membershipId)).all()).toHaveLength(1)
  })

  it('accepte un nombre de parts choisi par le président', async () => {
    const membershipId = await demandeEnAttente()
    approuverAdhesion(db, membershipId, PRESIDENT, 2)

    expect(db.select().from(shares).where(eq(shares.membershipId, membershipId)).all()).toHaveLength(2)
  })

  it('inscrit l’accord au registre', async () => {
    const membershipId = await demandeEnAttente()
    approuverAdhesion(db, membershipId, PRESIDENT)

    const ecritures = db.select().from(ledgerEntries).all()
      .filter(e => e.type === 'member_joined' && (e.payload as { approuve?: boolean }).approuve === true)
    expect(ecritures).toHaveLength(1)
  })

  it('refuse d’approuver une fois la rotation figée', async () => {
    const membershipId = await demandeEnAttente()
    db.update(tontines).set({ status: 'running', rotationFrozenAt: new Date() }).where(eq(tontines.id, T)).run()

    // Les tours sont générés d'un coup au démarrage : ajouter une part ensuite
    // ne créerait ni le tour du nouveau venu ni ses cotisations.
    expect(() => approuverAdhesion(db, membershipId, PRESIDENT)).toThrow(
      expect.objectContaining({ statusCode: 403 }),
    )
  })

  it('fait sortir le demandeur quand le président refuse', async () => {
    const membershipId = await demandeEnAttente()
    refuserAdhesion(db, membershipId, PRESIDENT)

    const [m] = db.select().from(memberships).where(eq(memberships.id, membershipId)).all()
    expect(m!.status).toBe('left')
    expect(db.select().from(shares).where(eq(shares.membershipId, membershipId)).all()).toHaveLength(0)
  })

  it('n’accueille plus de nouvel arrivant sur une tontine démarrée', async () => {
    await createTestUser(db, ARRIVANT, '+2250707000002')
    db.update(tontines).set({ status: 'running', rotationFrozenAt: new Date() }).where(eq(tontines.id, T)).run()
    const { token } = creerInvitation(db, T, PRESIDENT)

    // On le dit au moment du clic, plutôt que de le laisser attendre un accord
    // que le président ne pourrait pas donner.
    expect(() => accepterInvitation(db, token, ARRIVANT)).toThrow(
      expect.objectContaining({ statusCode: 403 }),
    )
  })

  it('laisse malgré tout un membre géré reprendre son siège', async () => {
    const membershipId = ajouterMembreGere(db, T, { name: 'Yao Brou', phone: NUMERO_GERE, shares: 1 })
    await createTestUser(db, ARRIVANT, NUMERO_GERE)
    db.update(tontines).set({ status: 'running', rotationFrozenAt: new Date() }).where(eq(tontines.id, T)).run()
    const { token } = creerInvitation(db, T, PRESIDENT)

    // Son siège existe déjà et ses cotisations sont à son nom : il ne prend la
    // place de personne, il reprend la sienne.
    const resultat = accepterInvitation(db, token, ARRIVANT)
    expect(resultat.rattache).toBe(true)
    expect(resultat.membershipId).toBe(membershipId)
  })
})
