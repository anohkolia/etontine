import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  approuverDemande,
  creerDemande,
  demandesEnAttente,
  effectifDe,
  etatAbonnement,
  palierDe,
  placeDisponible,
  rejeterDemande,
  tontinesActivesDe,
  verifierQuotaMembres,
  verifierQuotaTontines,
} from '../../server/services/abonnement.ts'
import { accepterInvitation, apercuInvitation, creerInvitation } from '../../server/services/invitations.ts'
import { ajouterMembreGere } from '../../server/services/membres.ts'
import { creerBrouillon } from '../../server/services/tontines.ts'
import { PALIER_PAR_ID } from '../../shared/constants/abonnement.ts'
import { adminAudit, memberships, notifications, subscriptionRequests, tontines, users } from '../../server/db/schema.ts'
import type { User } from '../../server/db/schema.ts'
import { createTestDb, createTestUser } from '../helpers/db.ts'
import type { TestDb } from '../helpers/db.ts'

let db: TestDb
let cleanup: () => void

const PRESIDENT = 'a1000000-0000-4000-8000-000000000001'
const ARRIVANT = 'a1000000-0000-4000-8000-000000000002'
const ADMIN = { id: 'a1000000-0000-4000-8000-000000000003', phone: '+2250707009999' }

const LE_5_MARS = new Date('2026-03-05T10:00:00Z')

function lire(id: string): User {
  const [u] = db.select().from(users).where(eq(users.id, id)).limit(1).all()
  return u!
}

/** Une tontine publiée, présidée par `PRESIDENT`. */
function tontineActive(nom: string, statut: 'open' | 'running' = 'running'): string {
  const id = creerBrouillon(db, PRESIDENT, { name: nom, access: 'private' })
  db.update(tontines).set({ status: statut, shareAmount: 25_000 }).where(eq(tontines.id, id)).run()
  return id
}

/** Remplit la tontine jusqu'à `total` adhésions, président compris. */
function remplir(tontineId: string, total: number): void {
  for (let i = effectifDe(db, tontineId); i < total; i++) {
    ajouterMembreGere(db, tontineId, {
      name: `Membre ${i}`,
      // Préfixe distinct de celui des comptes du test : un membre géré dont le
      // numéro coïncide avec un compte serait rattaché au lieu d'être ajouté.
      phone: `+2250505${String(i).padStart(6, '0')}`,
      shares: 1,
    })
  }
}

beforeEach(async () => {
  const ctx = createTestDb()
  db = ctx.db
  cleanup = ctx.cleanup

  await createTestUser(db, PRESIDENT, '+2250707000001')
  await createTestUser(db, ARRIVANT, '+2250707000002')
  await createTestUser(db, ADMIN.id, ADMIN.phone)

  db.update(users)
    .set({ firstName: 'Aya', lastName: 'Koné' })
    .where(eq(users.id, PRESIDENT))
    .run()
})

afterEach(() => cleanup())

describe('palier en vigueur', () => {
  it('est le gratuit par défaut', () => {
    expect(palierDe(lire(PRESIDENT)).id).toBe('free')
  })

  it('suit le palier posé tant que les droits courent', () => {
    db.update(users)
      .set({ planTier: 'standard', planUntil: new Date('2026-04-01T00:00:00Z') })
      .where(eq(users.id, PRESIDENT))
      .run()

    expect(palierDe(lire(PRESIDENT), LE_5_MARS).id).toBe('standard')
  })

  it('retombe au gratuit dès l’échéance passée, sans qu’aucune tâche n’ait tourné', () => {
    // La péremption est calculée, jamais écrite : un champ qui se périme tout
    // seul ne peut pas se désynchroniser d'un `cron` qui n'a pas tourné.
    db.update(users)
      .set({ planTier: 'plus', planUntil: new Date('2026-03-01T00:00:00Z') })
      .where(eq(users.id, PRESIDENT))
      .run()

    expect(palierDe(lire(PRESIDENT), LE_5_MARS).id).toBe('free')
    // La colonne n'a pas bougé pour autant : l'historique reste lisible.
    expect(lire(PRESIDENT).planTier).toBe('plus')
  })
})

describe('quota de tontines — au franchissement, jamais sur l’existant', () => {
  it('ne compte que les tontines publiées et non closes', () => {
    creerBrouillon(db, PRESIDENT, { name: 'Brouillon', access: 'private' })
    tontineActive('En cours')
    const close = tontineActive('Close')
    db.update(tontines).set({ status: 'closed' }).where(eq(tontines.id, close)).run()

    // Un brouillon n'engage personne et n'occupe aucune place ; une tontine
    // close a rendu la sienne.
    expect(tontinesActivesDe(db, PRESIDENT)).toBe(1)
  })

  it('refuse la deuxième tontine au palier gratuit', () => {
    tontineActive('La première')

    expect(() => verifierQuotaTontines(db, lire(PRESIDENT))).toThrow(
      expect.objectContaining({ statusCode: 403, statusMessage: 'PLAN_LIMIT' }),
    )
  })

  it('laisse passer tant que la place existe', () => {
    expect(() => verifierQuotaTontines(db, lire(PRESIDENT))).not.toThrow()

    db.update(users)
      .set({ planTier: 'standard', planUntil: new Date('2026-04-01T00:00:00Z') })
      .where(eq(users.id, PRESIDENT))
      .run()
    tontineActive('Une')
    tontineActive('Deux')

    expect(() => verifierQuotaTontines(db, lire(PRESIDENT), LE_5_MARS)).not.toThrow()
  })

  it('ne casse rien quand l’existant dépasse déjà le palier', () => {
    // Le cas de la rétrogradation : un président repasse au gratuit avec trois
    // tontines en cours. Une tontine rotative est un cycle fermé — couper
    // l'écran au tour 6 sur 12 ne suspend rien dans la réalité, ça ne fait que
    // rendre le registre faux. Les trois continuent donc, seule l'ouverture
    // d'une quatrième est refusée.
    const encours = [tontineActive('Une'), tontineActive('Deux'), tontineActive('Trois')]

    const etat = etatAbonnement(db, lire(PRESIDENT))
    expect(etat.auDessus).toBe(true)
    expect(etat.consommation.tontinesActives).toBe(3)
    expect(etat.consommation.tontines).toHaveLength(3)

    for (const id of encours) {
      const [t] = db.select().from(tontines).where(eq(tontines.id, id)).limit(1).all()
      expect(t!.status).toBe('running')
    }

    expect(() => verifierQuotaTontines(db, lire(PRESIDENT))).toThrow(
      expect.objectContaining({ statusCode: 403 }),
    )
  })
})

describe('quota de membres', () => {
  it('compte toute adhésion sauf celles qui sont parties', () => {
    const t = tontineActive('Tontine')
    remplir(t, 4)
    expect(effectifDe(db, t)).toBe(4)

    const [dernier] = db
      .select()
      .from(memberships)
      .where(eq(memberships.tontineId, t))
      .all()
      .slice(-1)
    db.update(memberships).set({ status: 'left' }).where(eq(memberships.id, dernier!.id)).run()

    // Une place rendue redevient disponible ; un membre en défaut, non — il est
    // toujours dans le groupe.
    expect(effectifDe(db, t)).toBe(3)
  })

  it('refuse le seizième membre au palier gratuit', () => {
    const t = tontineActive('Tontine pleine')
    remplir(t, PALIER_PAR_ID.free.membresParTontine!)

    expect(placeDisponible(db, t)).toBe(false)
    expect(() => verifierQuotaMembres(db, t)).toThrow(
      expect.objectContaining({ statusCode: 403, statusMessage: 'PLAN_LIMIT' }),
    )
  })

  it('s’applique au palier du président, pas à celui de l’arrivant', () => {
    db.update(users)
      .set({ planTier: 'standard', planUntil: new Date('2026-04-01T00:00:00Z') })
      .where(eq(users.id, PRESIDENT))
      .run()

    const t = tontineActive('Tontine du président abonné')
    remplir(t, 20)

    // 20 membres : au-dessus du gratuit, sous le Standard. C'est le palier du
    // président qui tranche — l'arrivant ne paie pas la tontine qu'il rejoint.
    expect(() => verifierQuotaMembres(db, t, 1, LE_5_MARS)).not.toThrow()
  })
})

describe('invitation — le lien cesse d’être partageable quand le groupe est plein', () => {
  it('annonce un groupe complet dans l’aperçu public', () => {
    const t = tontineActive('Tontine pleine')
    const { token } = creerInvitation(db, t, PRESIDENT)
    remplir(t, PALIER_PAR_ID.free.membresParTontine!)

    const apercu = apercuInvitation(db, token)
    // L'arrivant lit « complet », jamais « le président n'a pas payé » :
    // l'abonnement de quelqu'un d'autre ne le regarde pas.
    expect(apercu.complet).toBe(true)
    expect(JSON.stringify(apercu)).not.toContain('palier')
  })

  it('refuse un nouvel arrivant une fois la limite atteinte', () => {
    // `open` et non `running` : une tontine démarrée n'accueille de toute façon
    // plus personne — sa rotation est figée. C'est bien le quota qu'on éprouve
    // ici, pas ce refus-là.
    const t = tontineActive('Tontine pleine', 'open')
    const { token } = creerInvitation(db, t, PRESIDENT)
    remplir(t, PALIER_PAR_ID.free.membresParTontine!)

    expect(() => accepterInvitation(db, token, ARRIVANT)).toThrow(
      expect.objectContaining({ statusCode: 403, statusMessage: 'PLAN_LIMIT' }),
    )
  })

  it('laisse malgré tout un membre géré rattacher son compte', () => {
    // Il occupe déjà son siège : le rattachement n'ajoute personne, il relie un
    // compte à une adhésion existante. Le refuser dédoublerait son historique
    // ou le laisserait dehors alors qu'il cotise depuis des mois.
    const t = tontineActive('Tontine pleine')
    remplir(t, PALIER_PAR_ID.free.membresParTontine! - 1)
    ajouterMembreGere(db, t, { name: 'Yao Brou', phone: '+2250707000002', shares: 1 })
    expect(effectifDe(db, t)).toBe(PALIER_PAR_ID.free.membresParTontine)

    const { token } = creerInvitation(db, t, PRESIDENT)
    const resultat = accepterInvitation(db, token, ARRIVANT)

    expect(resultat.rattache).toBe(true)
    expect(effectifDe(db, t)).toBe(PALIER_PAR_ID.free.membresParTontine)
  })
})

describe('demande de passage', () => {
  it('fige le prix de la grille, jamais celui du client', () => {
    const mensuelle = creerDemande(db, PRESIDENT, { tier: 'standard', periodicity: 'monthly' })
    expect(mensuelle.priceFcfa).toBe(PALIER_PAR_ID.standard.prixMensuel)

    const [ligne] = db.select().from(subscriptionRequests).where(eq(subscriptionRequests.id, mensuelle.id)).all()
    expect(ligne!.priceFcfa).toBe(7_500)
  })

  it('applique les deux mois offerts sur l’année', () => {
    const annuelle = creerDemande(db, PRESIDENT, { tier: 'plus', periodicity: 'yearly' })
    expect(annuelle.priceFcfa).toBe(PALIER_PAR_ID.plus.prixAnnuel)
    expect(annuelle.priceFcfa).toBe(PALIER_PAR_ID.plus.prixMensuel * 10)
  })

  it('n’en accepte qu’une à la fois', () => {
    creerDemande(db, PRESIDENT, { tier: 'standard', periodicity: 'monthly' })

    expect(() => creerDemande(db, PRESIDENT, { tier: 'plus', periodicity: 'monthly' })).toThrow(
      expect.objectContaining({ statusCode: 409 }),
    )
    expect(demandesEnAttente(db)).toHaveLength(1)
  })
})

describe('décision du back-office', () => {
  it('pose le palier, l’échéance, la trace et la notification', () => {
    const demande = creerDemande(db, PRESIDENT, { tier: 'standard', periodicity: 'monthly' })
    const resultat = approuverDemande(db, demande.id, ADMIN, LE_5_MARS)

    expect(resultat.tier).toBe('standard')
    expect(resultat.planUntil.toISOString().slice(0, 10)).toBe('2026-04-05')
    expect(lire(PRESIDENT).planTier).toBe('standard')

    // La décision lève un quota : elle doit avoir un signataire.
    const journal = db.select().from(adminAudit).all()
    expect(journal).toHaveLength(1)
    expect(journal[0]!.action).toBe('abonnement_approuve')
    expect(journal[0]!.actorPhone).toBe(ADMIN.phone)

    // Règle 21 : la notification s'affiche sur un écran verrouillé.
    const [notif] = db.select().from(notifications).where(eq(notifications.userId, PRESIDENT)).all()
    expect(notif!.body).not.toMatch(/FCFA|\d{4}/)
  })

  it('prolonge les droits en cours quand le palier ne change pas', () => {
    db.update(users)
      .set({ planTier: 'standard', planUntil: new Date('2026-04-01T00:00:00Z') })
      .where(eq(users.id, PRESIDENT))
      .run()

    const demande = creerDemande(db, PRESIDENT, { tier: 'standard', periodicity: 'monthly' })
    const { planUntil } = approuverDemande(db, demande.id, ADMIN, LE_5_MARS)

    // Renouveler ne fait pas perdre les jours restants.
    expect(planUntil.toISOString().slice(0, 10)).toBe('2026-05-01')
  })

  it('repart de maintenant quand le palier change', () => {
    db.update(users)
      .set({ planTier: 'standard', planUntil: new Date('2026-04-01T00:00:00Z') })
      .where(eq(users.id, PRESIDENT))
      .run()

    const demande = creerDemande(db, PRESIDENT, { tier: 'plus', periodicity: 'yearly' })
    const { planUntil } = approuverDemande(db, demande.id, ADMIN, LE_5_MARS)

    expect(planUntil.toISOString().slice(0, 10)).toBe('2027-03-05')
  })

  it('ne garde pas le quantième d’un mois plus court', () => {
    const le31 = new Date('2026-01-31T10:00:00Z')
    const demande = creerDemande(db, PRESIDENT, { tier: 'standard', periodicity: 'monthly' })
    const { planUntil } = approuverDemande(db, demande.id, ADMIN, le31)

    // Sans repli sur le dernier jour, `setMonth` ferait glisser au 3 mars et
    // l'échéance dériverait d'un mois sur l'autre.
    expect(planUntil.toISOString().slice(0, 7)).toBe('2026-02')
  })

  it('ne se rejoue pas : une demande décidée est définitive', () => {
    const demande = creerDemande(db, PRESIDENT, { tier: 'standard', periodicity: 'monthly' })
    approuverDemande(db, demande.id, ADMIN, LE_5_MARS)

    expect(() => approuverDemande(db, demande.id, ADMIN, LE_5_MARS)).toThrow(
      expect.objectContaining({ statusCode: 409, statusMessage: 'INVALID_TRANSITION' }),
    )
    expect(() => rejeterDemande(db, demande.id, ADMIN, 'Règlement non constaté')).toThrow(
      expect.objectContaining({ statusCode: 409 }),
    )
  })

  it('exige un motif au refus, et le rend lisible par la personne', () => {
    const demande = creerDemande(db, PRESIDENT, { tier: 'plus', periodicity: 'monthly' })

    expect(() => rejeterDemande(db, demande.id, ADMIN, ' ')).toThrow(
      expect.objectContaining({ statusCode: 422 }),
    )

    rejeterDemande(db, demande.id, ADMIN, 'Règlement non constaté à ce jour.')

    const etat = etatAbonnement(db, lire(PRESIDENT))
    expect(etat.demandeEnCours).toBeNull()
    expect(lire(PRESIDENT).planTier).toBe('free')

    const [ligne] = db.select().from(subscriptionRequests).where(eq(subscriptionRequests.id, demande.id)).all()
    expect(ligne!.reviewNote).toBe('Règlement non constaté à ce jour.')
  })
})
