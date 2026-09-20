import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  accepterInvitation, apercuInvitation, approuverAdhesion, confirmerRattachement, creerInvitation,
  refuserAdhesion, refuserRattachement,
} from '../../server/services/invitations.ts'
import { ajouterMembreGere } from '../../server/services/membres.ts'
import { creerBrouillon, majTontine } from '../../server/services/tontines.ts'
import { useEngagement } from '../../app/composables/useEngagement.ts'
import { useMoney } from '../../app/composables/useMoney.ts'
import { ledgerEntries, memberships, notifications, shares, tontines } from '../../server/db/schema.ts'
import { createTestDb, createTestUser } from '../helpers/db.ts'
import type { TestDb } from '../helpers/db.ts'

let db: TestDb
let cleanup: () => Promise<void>
let T: string

const PRESIDENT = 'f0000000-0000-4000-8000-000000000001'
const ARRIVANT = 'f0000000-0000-4000-8000-000000000002'
const NUMERO_GERE = '+2250707000009'

beforeEach(async () => {
  const ctx = await createTestDb()
  db = ctx.db
  cleanup = ctx.cleanup

  await createTestUser(db, PRESIDENT, '+2250707000001')
  await db.update((await import('../../server/db/schema.ts')).users)
    .set({ firstName: 'Aya', lastName: 'Koné' })
    .where(eq((await import('../../server/db/schema.ts')).users.id, PRESIDENT))

  T = (await creerBrouillon(db, PRESIDENT, { name: 'Tontine des tantines', access: 'private' }))
  await majTontine(db, T, { shareAmount: 25_000, frequency: 'monthly', locality: 'Abobo' })
})

afterEach(() => cleanup())

describe('aperçu public — acceptation T12', () => {
  it('montre nom, président, montant, fréquence et nombre de membres', async () => {
    const { token } = await creerInvitation(db, T, PRESIDENT)
    const apercu = await apercuInvitation(db, token)

    // Un visiteur non connecté doit pouvoir juger avant de créer un compte.
    expect(apercu.name).toBe('Tontine des tantines')
    expect(apercu.presidentName).toBe('Aya Koné')
    expect(apercu.shareAmount).toBe(25_000)
    expect(apercu.frequency).toBe('monthly')
    expect(apercu.memberCount).toBe(1)
  })

  it('n’expose ni la liste des membres, ni leurs numéros', async () => {
    await ajouterMembreGere(db, T, { name: 'Yao Brou', phone: NUMERO_GERE, shares: 1 })
    const { token } = await creerInvitation(db, T, PRESIDENT)
    const texte = JSON.stringify(await apercuInvitation(db, token))

    // Un lien qui fuite ne doit pas livrer le carnet d'adresses du groupe.
    expect(texte).not.toContain(NUMERO_GERE)
    expect(texte).not.toContain('Yao Brou')
  })

  it('refuse un jeton inconnu, expiré ou épuisé', async () => {
    await expect(apercuInvitation(db, 'inexistant')).rejects.toThrow(
      expect.objectContaining({ statusCode: 404 }),
    )

    const { token } = await creerInvitation(db, T, PRESIDENT, 1)
    await createTestUser(db, ARRIVANT, '+2250707000002')
    await accepterInvitation(db, token, ARRIVANT)

    // Le lien à usage unique s'épuise : le second visiteur ne voit plus rien.
    await expect(apercuInvitation(db, token)).rejects.toThrow(
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
    const { token } = await creerInvitation(db, T, PRESIDENT)

    const resultat = await accepterInvitation(db, token, ARRIVANT)
    expect(resultat.status).toBe('pending_approval')
    expect(resultat.rattache).toBe(false)
  })

  it('demande le rattachement d’un membre géré, sans rien dupliquer ni rattacher encore', async () => {
    // Le bureau l'a saisi à la main ; il a déjà des cotisations à son compte.
    const membershipId = await ajouterMembreGere(db, T, {
      name: 'Yao Brou', phone: NUMERO_GERE, shares: 2,
    })

    await createTestUser(db, ARRIVANT, NUMERO_GERE)
    const { token } = await creerInvitation(db, T, PRESIDENT)

    const resultat = await accepterInvitation(db, token, ARRIVANT)

    // Acceptation T12 : rattaché, pas dupliqué — mais le numéro n'est plus
    // prouvé par SMS, donc c'est une demande, en attente du président.
    expect(resultat.rattache).toBe(true)
    expect(resultat.status).toBe('pending_approval')
    expect(resultat.membershipId).toBe(membershipId)

    const adhesions = await db.select().from(memberships).where(eq(memberships.tontineId, T))
    expect(adhesions.filter(m => m.managedPhone === NUMERO_GERE)).toHaveLength(1)
    const [siege] = adhesions.filter(m => m.id === membershipId)
    expect(siege!.userId).toBeNull()
    expect(siege!.claimedByUserId).toBe(ARRIVANT)

    // Ses deux parts sont conservées : les dédoubler fausserait le pot du groupe.
    expect(await db.select().from(shares).where(eq(shares.membershipId, membershipId))).toHaveLength(2)

    // Le président est prévenu, c'est lui qui tranche.
    const prevenus = await db.select().from(notifications)
    expect(prevenus.map(n => n.userId)).toEqual([PRESIDENT])
    expect(prevenus[0]!.type).toBe('rattachement_demande')
  })

  it('le président confirme : le compte prend le siège, avec son historique', async () => {
    const membershipId = await ajouterMembreGere(db, T, { name: 'Yao Brou', phone: NUMERO_GERE, shares: 2 })
    await createTestUser(db, ARRIVANT, NUMERO_GERE)
    const { token } = await creerInvitation(db, T, PRESIDENT)
    await accepterInvitation(db, token, ARRIVANT)

    await confirmerRattachement(db, membershipId, PRESIDENT)

    const [siege] = await db.select().from(memberships).where(eq(memberships.id, membershipId))
    expect(siege!.userId).toBe(ARRIVANT)
    expect(siege!.claimedByUserId).toBeNull()
    expect(siege!.status).toBe('active')
    expect(await db.select().from(shares).where(eq(shares.membershipId, membershipId))).toHaveLength(2)

    const ecritures = await db.select().from(ledgerEntries).where(eq(ledgerEntries.type, 'member_joined'))
    expect(ecritures).toHaveLength(1)
    expect((ecritures[0]!.payload as { rattachement: boolean }).rattachement).toBe(true)

    // Le demandeur l'apprend.
    const avis = (await db.select().from(notifications)).filter(n => n.userId === ARRIVANT)
    expect(avis.map(n => n.type)).toEqual(['rattachement_confirme'])
  })

  it('le président refuse : le siège reste géré, le demandeur l’apprend', async () => {
    const membershipId = await ajouterMembreGere(db, T, { name: 'Yao Brou', phone: NUMERO_GERE, shares: 1 })
    await createTestUser(db, ARRIVANT, NUMERO_GERE)
    const { token } = await creerInvitation(db, T, PRESIDENT)
    await accepterInvitation(db, token, ARRIVANT)

    await refuserRattachement(db, membershipId, PRESIDENT)

    const [siege] = await db.select().from(memberships).where(eq(memberships.id, membershipId))
    expect(siege!.userId).toBeNull()
    expect(siege!.claimedByUserId).toBeNull()
    expect(await db.select().from(ledgerEntries).where(eq(ledgerEntries.type, 'member_joined'))).toHaveLength(0)

    const avis = (await db.select().from(notifications)).filter(n => n.userId === ARRIVANT)
    expect(avis.map(n => n.type)).toEqual(['rattachement_refuse'])

    // Sans demande, il n'y a rien à confirmer.
    await expect(confirmerRattachement(db, membershipId, PRESIDENT)).rejects.toThrow(
      expect.objectContaining({ statusCode: 409 }),
    )
  })

  it('une seconde demande du même compte ne prévient pas le président deux fois', async () => {
    await ajouterMembreGere(db, T, { name: 'Yao Brou', phone: NUMERO_GERE, shares: 1 })
    await createTestUser(db, ARRIVANT, NUMERO_GERE)
    const { token } = await creerInvitation(db, T, PRESIDENT)

    await accepterInvitation(db, token, ARRIVANT)
    await accepterInvitation(db, token, ARRIVANT)

    expect(await db.select().from(notifications)).toHaveLength(1)
  })

  it('rapproche sur le numéro, pas sur le nom', async () => {
    // Deux membres peuvent porter le même nom, jamais le même numéro.
    await ajouterMembreGere(db, T, { name: 'Yao Brou', phone: NUMERO_GERE, shares: 1 })
    await createTestUser(db, ARRIVANT, '+2250707000077')

    const { token } = await creerInvitation(db, T, PRESIDENT)
    const resultat = await accepterInvitation(db, token, ARRIVANT)

    expect(resultat.rattache).toBe(false)
    expect(await db.select().from(memberships).where(eq(memberships.tontineId, T))).toHaveLength(3)
  })

  it('reste sans effet si l’on accepte deux fois', async () => {
    await createTestUser(db, ARRIVANT, '+2250707000002')
    const { token } = await creerInvitation(db, T, PRESIDENT)

    const premier = await accepterInvitation(db, token, ARRIVANT)
    const second = await accepterInvitation(db, token, ARRIVANT)

    expect(second.membershipId).toBe(premier.membershipId)
    expect(await db.select().from(memberships).where(eq(memberships.tontineId, T))).toHaveLength(2)
  })

  it('n’écrit rien au registre tant que le président n’a pas confirmé', async () => {
    await ajouterMembreGere(db, T, { name: 'Yao Brou', phone: NUMERO_GERE, shares: 1 })
    await createTestUser(db, ARRIVANT, NUMERO_GERE)

    const { token } = await creerInvitation(db, T, PRESIDENT)
    await accepterInvitation(db, token, ARRIVANT)

    // Une demande n'est pas une adhésion : le registre ne bouge qu'à la confirmation.
    expect(await db.select().from(ledgerEntries).where(eq(ledgerEntries.type, 'member_joined'))).toHaveLength(0)
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
    const { token } = await creerInvitation(db, T, PRESIDENT)
    return (await accepterInvitation(db, token, ARRIVANT)).membershipId
  }

  it('rend le membre actif **et** lui attribue sa part', async () => {
    const membershipId = await demandeEnAttente()

    // Sans la part, l'approbation ne servait à rien : le membre n'entrait dans
    // aucune rotation, ne cotisait jamais et ne prenait jamais la main.
    expect(await db.select().from(shares).where(eq(shares.membershipId, membershipId))).toHaveLength(0)

    await approuverAdhesion(db, membershipId, PRESIDENT)

    const [m] = await db.select().from(memberships).where(eq(memberships.id, membershipId))
    expect(m!.status).toBe('active')
    expect(await db.select().from(shares).where(eq(shares.membershipId, membershipId))).toHaveLength(1)
  })

  it('accepte un nombre de parts choisi par le président', async () => {
    const membershipId = await demandeEnAttente()
    await approuverAdhesion(db, membershipId, PRESIDENT, 2)

    expect(await db.select().from(shares).where(eq(shares.membershipId, membershipId))).toHaveLength(2)
  })

  it('inscrit l’accord au registre', async () => {
    const membershipId = await demandeEnAttente()
    await approuverAdhesion(db, membershipId, PRESIDENT)

    const ecritures = (await db.select().from(ledgerEntries))
      .filter(e => e.type === 'member_joined' && (e.payload as { approuve?: boolean }).approuve === true)
    expect(ecritures).toHaveLength(1)
  })

  it('refuse d’approuver une fois la rotation figée', async () => {
    const membershipId = await demandeEnAttente()
    await db.update(tontines).set({ status: 'running', rotationFrozenAt: new Date() }).where(eq(tontines.id, T))

    // Les tours sont générés d'un coup au démarrage : ajouter une part ensuite
    // ne créerait ni le tour du nouveau venu ni ses cotisations.
    await expect(approuverAdhesion(db, membershipId, PRESIDENT)).rejects.toThrow(
      expect.objectContaining({ statusCode: 403 }),
    )
  })

  it('fait sortir le demandeur quand le président refuse', async () => {
    const membershipId = await demandeEnAttente()
    await refuserAdhesion(db, membershipId, PRESIDENT)

    const [m] = await db.select().from(memberships).where(eq(memberships.id, membershipId))
    expect(m!.status).toBe('left')
    expect(await db.select().from(shares).where(eq(shares.membershipId, membershipId))).toHaveLength(0)
  })

  it('n’accueille plus de nouvel arrivant sur une tontine démarrée', async () => {
    await createTestUser(db, ARRIVANT, '+2250707000002')
    await db.update(tontines).set({ status: 'running', rotationFrozenAt: new Date() }).where(eq(tontines.id, T))
    const { token } = await creerInvitation(db, T, PRESIDENT)

    // On le dit au moment du clic, plutôt que de le laisser attendre un accord
    // que le président ne pourrait pas donner.
    await expect(accepterInvitation(db, token, ARRIVANT)).rejects.toThrow(
      expect.objectContaining({ statusCode: 403 }),
    )
  })

  it('laisse malgré tout un membre géré reprendre son siège', async () => {
    const membershipId = await ajouterMembreGere(db, T, { name: 'Yao Brou', phone: NUMERO_GERE, shares: 1 })
    await createTestUser(db, ARRIVANT, NUMERO_GERE)
    await db.update(tontines).set({ status: 'running', rotationFrozenAt: new Date() }).where(eq(tontines.id, T))
    const { token } = await creerInvitation(db, T, PRESIDENT)

    // Son siège existe déjà et ses cotisations sont à son nom : il ne prend la
    // place de personne, il reprend la sienne — sous réserve du président.
    const resultat = await accepterInvitation(db, token, ARRIVANT)
    expect(resultat.rattache).toBe(true)
    expect(resultat.membershipId).toBe(membershipId)
    await confirmerRattachement(db, membershipId, PRESIDENT)
    const [siege] = await db.select().from(memberships).where(eq(memberships.id, membershipId))
    expect(siege!.userId).toBe(ARRIVANT)
  })
})
