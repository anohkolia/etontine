import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  confirmateursPossibles, confirmerDeclaration, confirmerEnLot, fileDAttente, rejeterDeclaration,
  rouvrirCotisation,
} from '../../server/services/confirmations.ts'
import { declarerEspeces, declarerPaiement } from '../../server/services/declarations.ts'
import { reconnaitreVersement } from '../../server/services/escalade.ts'
import { ajouterMembreGere } from '../../server/services/membres.ts'
import { creerCanal, marquerVerifie } from '../../server/services/canaux.ts'
import { creerBrouillon, definirCanaux, majTontine, publier } from '../../server/services/tontines.ts'
import { demarrerTontine } from '../../server/services/tours.ts'
import { contributions, ledgerEntries, memberships, notifications, paymentDeclarations } from '../../server/db/schema.ts'
import { createTestDb, createTestUser } from '../helpers/db.ts'
import type { TestDb } from '../helpers/db.ts'

let db: TestDb
let cleanup: () => Promise<void>
let T: string

const PRESIDENT = 'c1000000-0000-4000-8000-000000000001'
const TRESORIER = 'c1000000-0000-4000-8000-000000000002'
const MEMBRE = 'c1000000-0000-4000-8000-000000000003'

/**
 * Rattache un membre géré à un compte, pour qu'il puisse déclarer et être
 * notifié — et lui pose sa casquette.
 *
 * Le rôle n'est pas décoratif ici : `confirmerDeclaration` s'en sert pour
 * savoir s'il existe un second valideur possible. Un « trésorier » resté
 * `member` laisserait le bureau à une seule personne, et les déclarations du
 * président seraient confirmées d'office au lieu d'attendre en file.
 */
async function rattacher(nom: string, userId: string, role: 'treasurer' | 'member' = 'member') {
  const [gere] = (await db.select().from(memberships)).filter(m => m.managedName === nom)
  await db.update(memberships).set({ userId, role }).where(eq(memberships.id, gere!.id))
  return gere!.id
}

async function cotisationDe(membershipId: string) {
  return (await db.select().from(contributions)).find(c => c.membershipId === membershipId)!
}

beforeEach(async () => {
  const ctx = await createTestDb()
  db = ctx.db
  cleanup = ctx.cleanup

  await createTestUser(db, PRESIDENT, '+2250707000001')
  await createTestUser(db, TRESORIER, '+2250707000002')
  await createTestUser(db, MEMBRE, '+2250707000003')

  T = (await creerBrouillon(db, PRESIDENT, { name: 'Tontine des tantines', access: 'private' }))
  await majTontine(db, T, { shareAmount: 25_000, frequency: 'monthly', startDate: '2026-01-15' })

  await ajouterMembreGere(db, T, { name: 'Koffi', phone: '+2250707000002', shares: 1 })
  await ajouterMembreGere(db, T, { name: 'Fatou', phone: '+2250707000003', shares: 1 })

  const canal = await creerCanal(db, PRESIDENT, { provider: 'wave', msisdn: '+2250707000001', holderName: 'Aya' })
  await marquerVerifie(db, canal)
  await definirCanaux(db, T, [canal], PRESIDENT)
  await publier(db, T)
  await demarrerTontine(db, T, PRESIDENT)

  await rattacher('Koffi', TRESORIER, 'treasurer')
  await rattacher('Fatou', MEMBRE)
})

afterEach(() => cleanup())

const ENVOI = { amount: 25_000, channel: 'wave' as const }

describe('séparation déclarant / décideur — acceptation T16', () => {
  it('refuse de confirmer sa propre déclaration, avec un 403', async () => {
    const [gere] = (await db.select().from(memberships)).filter(m => m.userId === TRESORIER)
    const sienne = await cotisationDe(gere!.id)
    const { declarationId } = await declarerPaiement(db, sienne.id, TRESORIER, ENVOI)

    // C'est le contrôle qui empêche un organisateur de se déclarer à jour tout
    // seul. Masquer un bouton côté client n'empêcherait rien.
    await expect(confirmerDeclaration(db, declarationId, TRESORIER)).rejects.toThrow(
      expect.objectContaining({ statusCode: 403 }),
    )
  })

  it('accepte la confirmation par quelqu’un d’autre', async () => {
    const [gere] = (await db.select().from(memberships)).filter(m => m.userId === TRESORIER)
    const { declarationId } = await declarerPaiement(db, (await cotisationDe(gere!.id)).id, TRESORIER, ENVOI)

    await confirmerDeclaration(db, declarationId, PRESIDENT)
  })

  it('refuse aussi de rejeter sa propre déclaration', async () => {
    const [gere] = (await db.select().from(memberships)).filter(m => m.userId === TRESORIER)
    const { declarationId } = await declarerPaiement(db, (await cotisationDe(gere!.id)).id, TRESORIER, ENVOI)

    await expect(rejeterDeclaration(db, declarationId, TRESORIER, 'Envoi introuvable')).rejects.toThrow(
      expect.objectContaining({ statusCode: 403 }),
    )
  })
})

describe('confirmation', () => {
  async function declarationDuMembre() {
    const [gere] = (await db.select().from(memberships)).filter(m => m.userId === MEMBRE)
    return {
      membershipId: gere!.id,
      contribution: await cotisationDe(gere!.id),
      ...await declarerPaiement(db, (await cotisationDe(gere!.id)).id, MEMBRE, ENVOI),
    }
  }

  it('passe la cotisation à « confirmé » et cumule le montant', async () => {
    const { declarationId, contribution } = await declarationDuMembre()
    await confirmerDeclaration(db, declarationId, TRESORIER)

    const [c] = await db.select().from(contributions).where(eq(contributions.id, contribution.id))
    expect(c!.status).toBe('confirmed')
    expect(c!.confirmedAmount).toBe(25_000)
  })

  it('laisse la cotisation ouverte sur un paiement partiel', async () => {
    const [gere] = (await db.select().from(memberships)).filter(m => m.userId === MEMBRE)
    const cotisation = await cotisationDe(gere!.id)
    const { declarationId } = await declarerPaiement(db, cotisation.id, MEMBRE, { ...ENVOI, amount: 10_000 })

    await confirmerDeclaration(db, declarationId, TRESORIER)

    const [c] = await db.select().from(contributions).where(eq(contributions.id, cotisation.id))
    // Le dû n'est pas atteint : la cotisation redevient à verser, pas confirmée.
    expect(c!.confirmedAmount).toBe(10_000)
    expect(c!.status).toBe('due')
  })

  it('génère une écriture au registre', async () => {
    const { declarationId } = await declarationDuMembre()
    await confirmerDeclaration(db, declarationId, TRESORIER)

    const ecritures = await db.select().from(ledgerEntries).where(eq(ledgerEntries.type, 'contribution_confirmed'))
    expect(ecritures).toHaveLength(1)
    expect(ecritures[0]!.actorId).toBe(TRESORIER)
  })

  it('notifie le membre, sans mentionner de montant', async () => {
    const { declarationId } = await declarationDuMembre()
    await confirmerDeclaration(db, declarationId, TRESORIER)

    const pourLuiF = (await db.select().from(notifications)).filter(n => n.userId === MEMBRE)
    expect(pourLuiF).toHaveLength(1)
    // Règle 21 : une notification s'affiche sur un écran verrouillé.
    expect(pourLuiF[0]!.body).not.toMatch(/FCFA|\d{4}/)
  })
})

describe('rejet — le motif est obligatoire', () => {
  async function declarationDuMembre() {
    const [gere] = (await db.select().from(memberships)).filter(m => m.userId === MEMBRE)
    return await declarerPaiement(db, (await cotisationDe(gere!.id)).id, MEMBRE, ENVOI)
  }

  it('refuse un rejet sans motif', async () => {
    const { declarationId } = await declarationDuMembre()

    // Un rejet sans explication, sur de l'argent qu'on affirme avoir envoyé,
    // est la meilleure façon de casser une tontine.
    await expect(rejeterDeclaration(db, declarationId, TRESORIER, '')).rejects.toThrow(
      expect.objectContaining({ statusCode: 422 }),
    )
    await expect(rejeterDeclaration(db, declarationId, TRESORIER, 'non')).rejects.toThrow(
      expect.objectContaining({ statusCode: 422 }),
    )
  })

  it('place la cotisation en contestation et conserve le motif', async () => {
    const { declarationId } = await declarationDuMembre()
    await rejeterDeclaration(db, declarationId, TRESORIER, 'Aucun envoi retrouvé à ce montant')

    const [d] = await db.select().from(paymentDeclarations).where(eq(paymentDeclarations.id, declarationId))
    expect(d!.decision).toBe('rejected')
    expect(d!.rejectionReason).toBe('Aucun envoi retrouvé à ce montant')

    const [c] = await db.select().from(contributions).where(eq(contributions.id, d!.contributionId))
    expect(c!.status).toBe('disputed')
  })
})

describe('« tout confirmer » — idempotence (acceptation T16)', () => {
  async function deuxDeclarations() {
    const gereMembre = (await db.select().from(memberships)).find(m => m.userId === MEMBRE)!
    const gerePresident = (await db.select().from(memberships)).find(m => m.userId === PRESIDENT)!

    return [
      (await declarerPaiement(db, (await cotisationDe(gereMembre.id)).id, MEMBRE, ENVOI)).declarationId,
      (await declarerPaiement(db, (await cotisationDe(gerePresident.id)).id, PRESIDENT, ENVOI)).declarationId,
    ]
  }

  it('confirme le lot, puis ne refait rien au second passage', async () => {
    const ids = await deuxDeclarations()

    const premier = await confirmerEnLot(db, ids, TRESORIER)
    expect(premier.confirmees).toBe(2)

    // Le trésorier retape sur le bouton parce que la liste n'a pas bougé.
    const second = await confirmerEnLot(db, ids, TRESORIER)
    expect(second.confirmees).toBe(0)
    expect(second.ignorees).toHaveLength(2)

    // Et surtout, aucun double comptage.
    const confirmees = (await db.select().from(contributions)).filter(c => c.confirmedAmount > 0)
    expect(confirmees.every(c => c.confirmedAmount === 25_000)).toBe(true)
  })

  it('ignore ses propres déclarations sans faire échouer le lot', async () => {
    const gereTresorier = (await db.select().from(memberships)).find(m => m.userId === TRESORIER)!
    const gereMembre = (await db.select().from(memberships)).find(m => m.userId === MEMBRE)!

    const sienne = (await declarerPaiement(db, (await cotisationDe(gereTresorier.id)).id, TRESORIER, ENVOI)).declarationId
    const autre = (await declarerPaiement(db, (await cotisationDe(gereMembre.id)).id, MEMBRE, ENVOI)).declarationId

    const resultat = await confirmerEnLot(db, [sienne, autre], TRESORIER)

    expect(resultat.confirmees).toBe(1)
    expect(resultat.ignorees).toEqual([{ id: sienne, raison: 'propre_declaration' }])
  })
})

describe('file d’attente', () => {
  it('ne liste que les déclarations en attente', async () => {
    const gereMembre = (await db.select().from(memberships)).find(m => m.userId === MEMBRE)!
    const { declarationId } = await declarerPaiement(db, (await cotisationDe(gereMembre.id)).id, MEMBRE, ENVOI)

    expect(await fileDAttente(db, T)).toHaveLength(1)

    await confirmerDeclaration(db, declarationId, TRESORIER)
    expect(await fileDAttente(db, T)).toHaveLength(0)
  })
})

describe('bureau d’une seule personne — repli sur la règle de séparation §2.4', () => {
  /** Retire au trésorier sa casquette : le président reste seul au bureau. */
  async function bureauSeul() {
    await db.update(memberships).set({ role: 'member' }).where(eq(memberships.userId, TRESORIER))
  }

  async function maCotisation() {
    const sienne = (await db.select().from(memberships)).find(m => m.userId === PRESIDENT)!
    return (await cotisationDe(sienne.id)).id
  }

  it('ne voit aucun valideur possible quand le président est seul au bureau', async () => {
    await bureauSeul()
    expect(await confirmateursPossibles(db, T, PRESIDENT)).toHaveLength(0)
  })

  it('confirme d’office la cotisation du président, faute de tiers', async () => {
    await bureauSeul()
    const resultat = await declarerPaiement(db, await maCotisation(), PRESIDENT, ENVOI)

    // Sans ce repli, sa cotisation resterait « déclarée » à chaque tour : il
    // serait en retard chez lui-même, et le pot toujours incomplet.
    expect(resultat.autoConfirmee).toBe(true)
    expect(resultat.contributionStatus).toBe('confirmed')

    const [c] = await db.select().from(contributions).where(eq(contributions.id, await maCotisation()))
    expect(c!.status).toBe('confirmed')
    expect(c!.confirmedAmount).toBe(25_000)
  })

  it('inscrit au registre que personne ne l’a vérifiée', async () => {
    await bureauSeul()
    await declarerPaiement(db, await maCotisation(), PRESIDENT, ENVOI)

    const [ecriture] = (await db.select().from(ledgerEntries))
      .filter(e => e.type === 'contribution_confirmed')
    const payload = ecriture!.payload as { autoConfirmee?: boolean, motif?: string }

    // Le groupe doit pouvoir distinguer au registre une cotisation validée par
    // un tiers d'une cotisation que son auteur a validée faute de tiers.
    expect(payload.autoConfirmee).toBe(true)
    expect(payload.motif).toBe('aucun_second_valideur')
  })

  it('ne s’annonce pas à soi-même que le trésorier a confirmé', async () => {
    await bureauSeul()
    await declarerPaiement(db, await maCotisation(), PRESIDENT, ENVOI)

    const siennes = (await db.select().from(notifications))
      .filter(n => n.userId === PRESIDENT && n.type === 'cotisation_confirmee')
    expect(siennes).toHaveLength(0)
  })

  it('ne confirme pas d’office la déclaration d’un membre : le président peut la voir', async () => {
    await bureauSeul()
    const sienne = (await db.select().from(memberships)).find(m => m.userId === MEMBRE)!
    const resultat = await declarerPaiement(db, (await cotisationDe(sienne.id)).id, MEMBRE, ENVOI)

    // Le repli ne vaut que pour celui qui n'a personne au-dessus de lui. La
    // cotisation d'un membre a un valideur — le président — et l'attend.
    expect(resultat.autoConfirmee).toBe(false)
    expect(resultat.contributionStatus).toBe('declared')
    expect(await fileDAttente(db, T)).toHaveLength(1)
  })

  it('reprend la règle de séparation dès qu’un second membre de bureau existe', async () => {
    // Bureau garni : le président ne peut plus valider sa propre déclaration.
    const { declarationId } = await declarerPaiement(db, await maCotisation(), PRESIDENT, ENVOI)

    await expect(confirmerDeclaration(db, declarationId, PRESIDENT)).rejects.toThrow(
      expect.objectContaining({ statusCode: 403 }),
    )
  })

  it('ne marque rien au registre quand la confirmation vient bien d’un tiers', async () => {
    const { declarationId } = await declarerPaiement(db, await maCotisation(), PRESIDENT, ENVOI)
    await confirmerDeclaration(db, declarationId, TRESORIER)

    const [ecriture] = (await db.select().from(ledgerEntries))
      .filter(e => e.type === 'contribution_confirmed')

    // Le cas courant garde exactement le payload qu'il avait : le marqueur
    // n'apparaît que là où il veut dire quelque chose.
    expect(ecriture!.payload).not.toHaveProperty('autoConfirmee')
  })
})

describe('espèces enregistrées par le bureau — la contrepartie côté membre', () => {
  async function especesPourLeMembre() {
    const sienne = (await db.select().from(memberships)).find(m => m.userId === MEMBRE)!
    return {
      membershipId: sienne.id,
      ...await declarerEspeces(db, (await cotisationDe(sienne.id)).id, TRESORIER, { amount: 25_000 }),
    }
  }

  it('marque la source et laisse la cotisation en attente de décision', async () => {
    const { declarationId } = await especesPourLeMembre()

    const [d] = await db.select().from(paymentDeclarations).where(eq(paymentDeclarations.id, declarationId))
    expect(d!.source).toBe('treasurer')
    expect(d!.channel).toBe('cash')
    expect(d!.decision).toBe('pending')
    // Elle n'est pas reconnue tant que l'intéressé n'a rien dit.
    expect(d!.memberAcknowledgedAt).toBeNull()
  })

  it('laisse le membre reconnaître le versement', async () => {
    const { declarationId } = await especesPourLeMembre()
    expect((await reconnaitreVersement(db, declarationId, MEMBRE)).ok).toBe(true)

    const [d] = await db.select().from(paymentDeclarations).where(eq(paymentDeclarations.id, declarationId))
    expect(d!.memberAcknowledgedAt).not.toBeNull()
  })

  it('refuse la reconnaissance par quelqu’un d’autre', async () => {
    const { declarationId } = await especesPourLeMembre()

    // Sans ce contrôle, le bureau se délivrerait à lui-même la reconnaissance
    // qui est censée le tenir.
    expect((await reconnaitreVersement(db, declarationId, TRESORIER)).ok).toBe(false)
  })

  it('laisse le membre contester ce qu’on a enregistré pour lui', async () => {
    const { declarationId } = await especesPourLeMembre()

    // §2.4 : « declared → disputed : trésorier, ou membre si déclaré par le
    // trésorier ». Le service l'autorisait déjà — c'est la route qui le
    // refusait, faute de rôle.
    await rejeterDeclaration(db, declarationId, MEMBRE, 'Je n’ai rien remis ce mois-ci')

    const [d] = await db.select().from(paymentDeclarations).where(eq(paymentDeclarations.id, declarationId))
    expect(d!.decision).toBe('rejected')

    const [c] = await db.select().from(contributions).where(eq(contributions.id, d!.contributionId))
    expect(c!.status).toBe('disputed')
  })

  it('interdit au trésorier de statuer sur ce qu’il a lui-même enregistré', async () => {
    const { declarationId } = await especesPourLeMembre()

    await expect(confirmerDeclaration(db, declarationId, TRESORIER)).rejects.toThrow(
      expect.objectContaining({ statusCode: 403 }),
    )
  })
})

describe('après un rejet — la cotisation repartait dans le vide', () => {
  async function rejetee() {
    const sienne = (await db.select().from(memberships)).find(m => m.userId === MEMBRE)!
    const contributionId = (await cotisationDe(sienne.id)).id
    const { declarationId } = await declarerPaiement(db, contributionId, MEMBRE, ENVOI)
    await rejeterDeclaration(db, declarationId, TRESORIER, 'Aucun envoi retrouvé à ce montant')
    return contributionId
  }

  it('interdit de re-déclarer tant que la cotisation est contestée', async () => {
    const contributionId = await rejetee()

    // `disputed` ne mène qu'à `confirmed` ou `due` : la machine à états refuse
    // une seconde déclaration, et rien n'empruntait le retour vers `due`. Le
    // motif du rejet demandait donc de corriger quelque chose qu'on ne pouvait
    // plus renvoyer.
    await expect(declarerPaiement(db, contributionId, MEMBRE, ENVOI)).rejects.toThrow(
      expect.objectContaining({ statusCode: 409 }),
    )
  })

  it('rouvre la cotisation, et le membre peut renvoyer', async () => {
    const contributionId = await rejetee()
    await rouvrirCotisation(db, contributionId, PRESIDENT)

    const [c] = await db.select().from(contributions).where(eq(contributions.id, contributionId))
    expect(c!.status).toBe('due')
    await declarerPaiement(db, contributionId, MEMBRE, ENVOI)
  })

  it('inscrit la réouverture au registre', async () => {
    const contributionId = await rejetee()
    await rouvrirCotisation(db, contributionId, PRESIDENT)

    const ecritures = (await db.select().from(ledgerEntries))
      .filter(e => (e.payload as { changement?: string }).changement === 'cotisation_rouverte')
    expect(ecritures).toHaveLength(1)
  })

  it('prévient le membre sans citer un montant (règle 21)', async () => {
    const contributionId = await rejetee()
    await rouvrirCotisation(db, contributionId, PRESIDENT)

    const envoyees = (await db.select().from(notifications)).filter(n => n.type === 'cotisation_rouverte')
    expect(envoyees).toHaveLength(1)
    expect(envoyees[0]!.userId).toBe(MEMBRE)
    expect(/FCFA|\d{4}/.test(envoyees[0]!.body)).toBe(false)
  })

  it('refuse de rouvrir une cotisation qui n’est pas contestée', async () => {
    const sienne = (await db.select().from(memberships)).find(m => m.userId === MEMBRE)!

    await expect(rouvrirCotisation(db, (await cotisationDe(sienne.id)).id, PRESIDENT)).rejects.toThrow(
      expect.objectContaining({ statusCode: 409 }),
    )
  })
})
