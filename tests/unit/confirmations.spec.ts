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
let cleanup: () => void
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
function rattacher(nom: string, userId: string, role: 'treasurer' | 'member' = 'member') {
  const [gere] = db.select().from(memberships).all().filter(m => m.managedName === nom)
  db.update(memberships).set({ userId, role }).where(eq(memberships.id, gere!.id)).run()
  return gere!.id
}

function cotisationDe(membershipId: string) {
  return db.select().from(contributions).all().find(c => c.membershipId === membershipId)!
}

beforeEach(async () => {
  const ctx = createTestDb()
  db = ctx.db
  cleanup = ctx.cleanup

  await createTestUser(db, PRESIDENT, '+2250707000001')
  await createTestUser(db, TRESORIER, '+2250707000002')
  await createTestUser(db, MEMBRE, '+2250707000003')

  T = creerBrouillon(db, PRESIDENT, { name: 'Tontine des tantines', access: 'private' })
  majTontine(db, T, { shareAmount: 25_000, frequency: 'monthly', startDate: '2026-01-15' })

  ajouterMembreGere(db, T, { name: 'Koffi', phone: '+2250707000002', shares: 1 })
  ajouterMembreGere(db, T, { name: 'Fatou', phone: '+2250707000003', shares: 1 })

  const canal = creerCanal(db, PRESIDENT, { provider: 'wave', msisdn: '+2250707000001', holderName: 'Aya' })
  marquerVerifie(db, canal)
  definirCanaux(db, T, [canal], PRESIDENT)
  publier(db, T)
  demarrerTontine(db, T, PRESIDENT)

  rattacher('Koffi', TRESORIER, 'treasurer')
  rattacher('Fatou', MEMBRE)
})

afterEach(() => cleanup())

const ENVOI = { amount: 25_000, channel: 'wave' as const }

describe('séparation déclarant / décideur — acceptation T16', () => {
  it('refuse de confirmer sa propre déclaration, avec un 403', () => {
    const [gere] = db.select().from(memberships).all().filter(m => m.userId === TRESORIER)
    const sienne = cotisationDe(gere!.id)
    const { declarationId } = declarerPaiement(db, sienne.id, TRESORIER, ENVOI)

    // C'est le contrôle qui empêche un organisateur de se déclarer à jour tout
    // seul. Masquer un bouton côté client n'empêcherait rien.
    expect(() => confirmerDeclaration(db, declarationId, TRESORIER)).toThrow(
      expect.objectContaining({ statusCode: 403 }),
    )
  })

  it('accepte la confirmation par quelqu’un d’autre', () => {
    const [gere] = db.select().from(memberships).all().filter(m => m.userId === TRESORIER)
    const { declarationId } = declarerPaiement(db, cotisationDe(gere!.id).id, TRESORIER, ENVOI)

    expect(() => confirmerDeclaration(db, declarationId, PRESIDENT)).not.toThrow()
  })

  it('refuse aussi de rejeter sa propre déclaration', () => {
    const [gere] = db.select().from(memberships).all().filter(m => m.userId === TRESORIER)
    const { declarationId } = declarerPaiement(db, cotisationDe(gere!.id).id, TRESORIER, ENVOI)

    expect(() => rejeterDeclaration(db, declarationId, TRESORIER, 'Envoi introuvable')).toThrow(
      expect.objectContaining({ statusCode: 403 }),
    )
  })
})

describe('confirmation', () => {
  function declarationDuMembre() {
    const [gere] = db.select().from(memberships).all().filter(m => m.userId === MEMBRE)
    return {
      membershipId: gere!.id,
      contribution: cotisationDe(gere!.id),
      ...declarerPaiement(db, cotisationDe(gere!.id).id, MEMBRE, ENVOI),
    }
  }

  it('passe la cotisation à « confirmé » et cumule le montant', () => {
    const { declarationId, contribution } = declarationDuMembre()
    confirmerDeclaration(db, declarationId, TRESORIER)

    const [c] = db.select().from(contributions).where(eq(contributions.id, contribution.id)).all()
    expect(c!.status).toBe('confirmed')
    expect(c!.confirmedAmount).toBe(25_000)
  })

  it('laisse la cotisation ouverte sur un paiement partiel', () => {
    const [gere] = db.select().from(memberships).all().filter(m => m.userId === MEMBRE)
    const cotisation = cotisationDe(gere!.id)
    const { declarationId } = declarerPaiement(db, cotisation.id, MEMBRE, { ...ENVOI, amount: 10_000 })

    confirmerDeclaration(db, declarationId, TRESORIER)

    const [c] = db.select().from(contributions).where(eq(contributions.id, cotisation.id)).all()
    // Le dû n'est pas atteint : la cotisation redevient à verser, pas confirmée.
    expect(c!.confirmedAmount).toBe(10_000)
    expect(c!.status).toBe('due')
  })

  it('génère une écriture au registre', () => {
    const { declarationId } = declarationDuMembre()
    confirmerDeclaration(db, declarationId, TRESORIER)

    const ecritures = db.select().from(ledgerEntries).where(eq(ledgerEntries.type, 'contribution_confirmed')).all()
    expect(ecritures).toHaveLength(1)
    expect(ecritures[0]!.actorId).toBe(TRESORIER)
  })

  it('notifie le membre, sans mentionner de montant', () => {
    const { declarationId } = declarationDuMembre()
    confirmerDeclaration(db, declarationId, TRESORIER)

    const pourLuiF = db.select().from(notifications).all().filter(n => n.userId === MEMBRE)
    expect(pourLuiF).toHaveLength(1)
    // Règle 21 : une notification s'affiche sur un écran verrouillé.
    expect(pourLuiF[0]!.body).not.toMatch(/FCFA|\d{4}/)
  })
})

describe('rejet — le motif est obligatoire', () => {
  function declarationDuMembre() {
    const [gere] = db.select().from(memberships).all().filter(m => m.userId === MEMBRE)
    return declarerPaiement(db, cotisationDe(gere!.id).id, MEMBRE, ENVOI)
  }

  it('refuse un rejet sans motif', () => {
    const { declarationId } = declarationDuMembre()

    // Un rejet sans explication, sur de l'argent qu'on affirme avoir envoyé,
    // est la meilleure façon de casser une tontine.
    expect(() => rejeterDeclaration(db, declarationId, TRESORIER, '')).toThrow(
      expect.objectContaining({ statusCode: 422 }),
    )
    expect(() => rejeterDeclaration(db, declarationId, TRESORIER, 'non')).toThrow(
      expect.objectContaining({ statusCode: 422 }),
    )
  })

  it('place la cotisation en contestation et conserve le motif', () => {
    const { declarationId } = declarationDuMembre()
    rejeterDeclaration(db, declarationId, TRESORIER, 'Aucun envoi retrouvé à ce montant')

    const [d] = db.select().from(paymentDeclarations).where(eq(paymentDeclarations.id, declarationId)).all()
    expect(d!.decision).toBe('rejected')
    expect(d!.rejectionReason).toBe('Aucun envoi retrouvé à ce montant')

    const [c] = db.select().from(contributions).where(eq(contributions.id, d!.contributionId)).all()
    expect(c!.status).toBe('disputed')
  })
})

describe('« tout confirmer » — idempotence (acceptation T16)', () => {
  function deuxDeclarations() {
    const gereMembre = db.select().from(memberships).all().find(m => m.userId === MEMBRE)!
    const gerePresident = db.select().from(memberships).all().find(m => m.userId === PRESIDENT)!

    return [
      declarerPaiement(db, cotisationDe(gereMembre.id).id, MEMBRE, ENVOI).declarationId,
      declarerPaiement(db, cotisationDe(gerePresident.id).id, PRESIDENT, ENVOI).declarationId,
    ]
  }

  it('confirme le lot, puis ne refait rien au second passage', () => {
    const ids = deuxDeclarations()

    const premier = confirmerEnLot(db, ids, TRESORIER)
    expect(premier.confirmees).toBe(2)

    // Le trésorier retape sur le bouton parce que la liste n'a pas bougé.
    const second = confirmerEnLot(db, ids, TRESORIER)
    expect(second.confirmees).toBe(0)
    expect(second.ignorees).toHaveLength(2)

    // Et surtout, aucun double comptage.
    const confirmees = db.select().from(contributions).all().filter(c => c.confirmedAmount > 0)
    expect(confirmees.every(c => c.confirmedAmount === 25_000)).toBe(true)
  })

  it('ignore ses propres déclarations sans faire échouer le lot', () => {
    const gereTresorier = db.select().from(memberships).all().find(m => m.userId === TRESORIER)!
    const gereMembre = db.select().from(memberships).all().find(m => m.userId === MEMBRE)!

    const sienne = declarerPaiement(db, cotisationDe(gereTresorier.id).id, TRESORIER, ENVOI).declarationId
    const autre = declarerPaiement(db, cotisationDe(gereMembre.id).id, MEMBRE, ENVOI).declarationId

    const resultat = confirmerEnLot(db, [sienne, autre], TRESORIER)

    expect(resultat.confirmees).toBe(1)
    expect(resultat.ignorees).toEqual([{ id: sienne, raison: 'propre_declaration' }])
  })
})

describe('file d’attente', () => {
  it('ne liste que les déclarations en attente', () => {
    const gereMembre = db.select().from(memberships).all().find(m => m.userId === MEMBRE)!
    const { declarationId } = declarerPaiement(db, cotisationDe(gereMembre.id).id, MEMBRE, ENVOI)

    expect(fileDAttente(db, T)).toHaveLength(1)

    confirmerDeclaration(db, declarationId, TRESORIER)
    expect(fileDAttente(db, T)).toHaveLength(0)
  })
})

describe('bureau d’une seule personne — repli sur la règle de séparation §2.4', () => {
  /** Retire au trésorier sa casquette : le président reste seul au bureau. */
  function bureauSeul() {
    db.update(memberships).set({ role: 'member' }).where(eq(memberships.userId, TRESORIER)).run()
  }

  function maCotisation() {
    const sienne = db.select().from(memberships).all().find(m => m.userId === PRESIDENT)!
    return cotisationDe(sienne.id).id
  }

  it('ne voit aucun valideur possible quand le président est seul au bureau', () => {
    bureauSeul()
    expect(confirmateursPossibles(db, T, PRESIDENT)).toHaveLength(0)
  })

  it('confirme d’office la cotisation du président, faute de tiers', () => {
    bureauSeul()
    const resultat = declarerPaiement(db, maCotisation(), PRESIDENT, ENVOI)

    // Sans ce repli, sa cotisation resterait « déclarée » à chaque tour : il
    // serait en retard chez lui-même, et le pot toujours incomplet.
    expect(resultat.autoConfirmee).toBe(true)
    expect(resultat.contributionStatus).toBe('confirmed')

    const [c] = db.select().from(contributions).where(eq(contributions.id, maCotisation())).all()
    expect(c!.status).toBe('confirmed')
    expect(c!.confirmedAmount).toBe(25_000)
  })

  it('inscrit au registre que personne ne l’a vérifiée', () => {
    bureauSeul()
    declarerPaiement(db, maCotisation(), PRESIDENT, ENVOI)

    const [ecriture] = db.select().from(ledgerEntries).all()
      .filter(e => e.type === 'contribution_confirmed')
    const payload = ecriture!.payload as { autoConfirmee?: boolean, motif?: string }

    // Le groupe doit pouvoir distinguer au registre une cotisation validée par
    // un tiers d'une cotisation que son auteur a validée faute de tiers.
    expect(payload.autoConfirmee).toBe(true)
    expect(payload.motif).toBe('aucun_second_valideur')
  })

  it('ne s’annonce pas à soi-même que le trésorier a confirmé', () => {
    bureauSeul()
    declarerPaiement(db, maCotisation(), PRESIDENT, ENVOI)

    const siennes = db.select().from(notifications).all()
      .filter(n => n.userId === PRESIDENT && n.type === 'cotisation_confirmee')
    expect(siennes).toHaveLength(0)
  })

  it('ne confirme pas d’office la déclaration d’un membre : le président peut la voir', () => {
    bureauSeul()
    const sienne = db.select().from(memberships).all().find(m => m.userId === MEMBRE)!
    const resultat = declarerPaiement(db, cotisationDe(sienne.id).id, MEMBRE, ENVOI)

    // Le repli ne vaut que pour celui qui n'a personne au-dessus de lui. La
    // cotisation d'un membre a un valideur — le président — et l'attend.
    expect(resultat.autoConfirmee).toBe(false)
    expect(resultat.contributionStatus).toBe('declared')
    expect(fileDAttente(db, T)).toHaveLength(1)
  })

  it('reprend la règle de séparation dès qu’un second membre de bureau existe', () => {
    // Bureau garni : le président ne peut plus valider sa propre déclaration.
    const { declarationId } = declarerPaiement(db, maCotisation(), PRESIDENT, ENVOI)

    expect(() => confirmerDeclaration(db, declarationId, PRESIDENT)).toThrow(
      expect.objectContaining({ statusCode: 403 }),
    )
  })

  it('ne marque rien au registre quand la confirmation vient bien d’un tiers', () => {
    const { declarationId } = declarerPaiement(db, maCotisation(), PRESIDENT, ENVOI)
    confirmerDeclaration(db, declarationId, TRESORIER)

    const [ecriture] = db.select().from(ledgerEntries).all()
      .filter(e => e.type === 'contribution_confirmed')

    // Le cas courant garde exactement le payload qu'il avait : le marqueur
    // n'apparaît que là où il veut dire quelque chose.
    expect(ecriture!.payload).not.toHaveProperty('autoConfirmee')
  })
})

describe('espèces enregistrées par le bureau — la contrepartie côté membre', () => {
  function especesPourLeMembre() {
    const sienne = db.select().from(memberships).all().find(m => m.userId === MEMBRE)!
    return {
      membershipId: sienne.id,
      ...declarerEspeces(db, cotisationDe(sienne.id).id, TRESORIER, { amount: 25_000 }),
    }
  }

  it('marque la source et laisse la cotisation en attente de décision', () => {
    const { declarationId } = especesPourLeMembre()

    const [d] = db.select().from(paymentDeclarations).where(eq(paymentDeclarations.id, declarationId)).all()
    expect(d!.source).toBe('treasurer')
    expect(d!.channel).toBe('cash')
    expect(d!.decision).toBe('pending')
    // Elle n'est pas reconnue tant que l'intéressé n'a rien dit.
    expect(d!.memberAcknowledgedAt).toBeNull()
  })

  it('laisse le membre reconnaître le versement', () => {
    const { declarationId } = especesPourLeMembre()
    expect(reconnaitreVersement(db, declarationId, MEMBRE).ok).toBe(true)

    const [d] = db.select().from(paymentDeclarations).where(eq(paymentDeclarations.id, declarationId)).all()
    expect(d!.memberAcknowledgedAt).not.toBeNull()
  })

  it('refuse la reconnaissance par quelqu’un d’autre', () => {
    const { declarationId } = especesPourLeMembre()

    // Sans ce contrôle, le bureau se délivrerait à lui-même la reconnaissance
    // qui est censée le tenir.
    expect(reconnaitreVersement(db, declarationId, TRESORIER).ok).toBe(false)
  })

  it('laisse le membre contester ce qu’on a enregistré pour lui', () => {
    const { declarationId } = especesPourLeMembre()

    // §2.4 : « declared → disputed : trésorier, ou membre si déclaré par le
    // trésorier ». Le service l'autorisait déjà — c'est la route qui le
    // refusait, faute de rôle.
    rejeterDeclaration(db, declarationId, MEMBRE, 'Je n’ai rien remis ce mois-ci')

    const [d] = db.select().from(paymentDeclarations).where(eq(paymentDeclarations.id, declarationId)).all()
    expect(d!.decision).toBe('rejected')

    const [c] = db.select().from(contributions).where(eq(contributions.id, d!.contributionId)).all()
    expect(c!.status).toBe('disputed')
  })

  it('interdit au trésorier de statuer sur ce qu’il a lui-même enregistré', () => {
    const { declarationId } = especesPourLeMembre()

    expect(() => confirmerDeclaration(db, declarationId, TRESORIER)).toThrow(
      expect.objectContaining({ statusCode: 403 }),
    )
  })
})

describe('après un rejet — la cotisation repartait dans le vide', () => {
  function rejetee() {
    const sienne = db.select().from(memberships).all().find(m => m.userId === MEMBRE)!
    const contributionId = cotisationDe(sienne.id).id
    const { declarationId } = declarerPaiement(db, contributionId, MEMBRE, ENVOI)
    rejeterDeclaration(db, declarationId, TRESORIER, 'Aucun envoi retrouvé à ce montant')
    return contributionId
  }

  it('interdit de re-déclarer tant que la cotisation est contestée', () => {
    const contributionId = rejetee()

    // `disputed` ne mène qu'à `confirmed` ou `due` : la machine à états refuse
    // une seconde déclaration, et rien n'empruntait le retour vers `due`. Le
    // motif du rejet demandait donc de corriger quelque chose qu'on ne pouvait
    // plus renvoyer.
    expect(() => declarerPaiement(db, contributionId, MEMBRE, ENVOI)).toThrow(
      expect.objectContaining({ statusCode: 409 }),
    )
  })

  it('rouvre la cotisation, et le membre peut renvoyer', () => {
    const contributionId = rejetee()
    rouvrirCotisation(db, contributionId, PRESIDENT)

    const [c] = db.select().from(contributions).where(eq(contributions.id, contributionId)).all()
    expect(c!.status).toBe('due')
    expect(() => declarerPaiement(db, contributionId, MEMBRE, ENVOI)).not.toThrow()
  })

  it('inscrit la réouverture au registre', () => {
    const contributionId = rejetee()
    rouvrirCotisation(db, contributionId, PRESIDENT)

    const ecritures = db.select().from(ledgerEntries).all()
      .filter(e => (e.payload as { changement?: string }).changement === 'cotisation_rouverte')
    expect(ecritures).toHaveLength(1)
  })

  it('prévient le membre sans citer un montant (règle 21)', () => {
    const contributionId = rejetee()
    rouvrirCotisation(db, contributionId, PRESIDENT)

    const envoyees = db.select().from(notifications).all().filter(n => n.type === 'cotisation_rouverte')
    expect(envoyees).toHaveLength(1)
    expect(envoyees[0]!.userId).toBe(MEMBRE)
    expect(/FCFA|\d{4}/.test(envoyees[0]!.body)).toBe(false)
  })

  it('refuse de rouvrir une cotisation qui n’est pas contestée', () => {
    const sienne = db.select().from(memberships).all().find(m => m.userId === MEMBRE)!

    expect(() => rouvrirCotisation(db, cotisationDe(sienne.id).id, PRESIDENT)).toThrow(
      expect.objectContaining({ statusCode: 409 }),
    )
  })
})
