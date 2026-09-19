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
let cleanup: () => Promise<void>

const PRESIDENT = 'a1000000-0000-4000-8000-000000000001'
const ARRIVANT = 'a1000000-0000-4000-8000-000000000002'
const ADMIN = { id: 'a1000000-0000-4000-8000-000000000003', phone: '+2250707009999' }

const LE_5_MARS = new Date('2026-03-05T10:00:00Z')

async function lire(id: string): Promise<User> {
  const [u] = await db.select().from(users).where(eq(users.id, id)).limit(1)
  return u!
}

/** Une tontine publiée, présidée par `PRESIDENT`. */
async function tontineActive(nom: string, statut: 'open' | 'running' = 'running'): Promise<string> {
  const id = await creerBrouillon(db, PRESIDENT, { name: nom, access: 'private' })
  await db.update(tontines).set({ status: statut, shareAmount: 25_000 }).where(eq(tontines.id, id))
  return id
}

/** Remplit la tontine jusqu'à `total` adhésions, président compris. */
async function remplir(tontineId: string, total: number): Promise<void> {
  for (let i = await effectifDe(db, tontineId); i < total; i++) {
    await ajouterMembreGere(db, tontineId, {
      name: `Membre ${i}`,
      // Préfixe distinct de celui des comptes du test : un membre géré dont le
      // numéro coïncide avec un compte serait rattaché au lieu d'être ajouté.
      phone: `+2250505${String(i).padStart(6, '0')}`,
      shares: 1,
    })
  }
}

beforeEach(async () => {
  const ctx = await createTestDb()
  db = ctx.db
  cleanup = ctx.cleanup

  await createTestUser(db, PRESIDENT, '+2250707000001')
  await createTestUser(db, ARRIVANT, '+2250707000002')
  await createTestUser(db, ADMIN.id, ADMIN.phone)

  await db.update(users)
    .set({ firstName: 'Aya', lastName: 'Koné' })
    .where(eq(users.id, PRESIDENT))
})

afterEach(() => cleanup())

describe('palier en vigueur', () => {
  it('est le gratuit par défaut', async () => {
    expect(palierDe(await lire(PRESIDENT)).id).toBe('free')
  })

  it('suit le palier posé tant que les droits courent', async () => {
    await db.update(users)
      .set({ planTier: 'standard', planUntil: new Date('2026-04-01T00:00:00Z') })
      .where(eq(users.id, PRESIDENT))

    expect(palierDe(await lire(PRESIDENT), LE_5_MARS).id).toBe('standard')
  })

  it('retombe au gratuit dès l’échéance passée, sans qu’aucune tâche n’ait tourné', async () => {
    // La péremption est calculée, jamais écrite : un champ qui se périme tout
    // seul ne peut pas se désynchroniser d'un `cron` qui n'a pas tourné.
    await db.update(users)
      .set({ planTier: 'plus', planUntil: new Date('2026-03-01T00:00:00Z') })
      .where(eq(users.id, PRESIDENT))

    expect(palierDe(await lire(PRESIDENT), LE_5_MARS).id).toBe('free')
    // La colonne n'a pas bougé pour autant : l'historique reste lisible.
    expect((await lire(PRESIDENT)).planTier).toBe('plus')
  })
})

describe('quota de tontines — au franchissement, jamais sur l’existant', () => {
  it('ne compte que les tontines publiées et non closes', async () => {
    await creerBrouillon(db, PRESIDENT, { name: 'Brouillon', access: 'private' })
    await tontineActive('En cours')
    const close = await tontineActive('Close')
    await db.update(tontines).set({ status: 'closed' }).where(eq(tontines.id, close))

    // Un brouillon n'engage personne et n'occupe aucune place ; une tontine
    // close a rendu la sienne.
    expect(await tontinesActivesDe(db, PRESIDENT)).toBe(1)
  })

  it('refuse la deuxième tontine au palier gratuit', async () => {
    await tontineActive('La première')

    await expect(verifierQuotaTontines(db, await lire(PRESIDENT))).rejects.toThrow(
      expect.objectContaining({ statusCode: 403, statusMessage: 'PLAN_LIMIT' }),
    )
  })

  it('laisse passer tant que la place existe', async () => {
    await verifierQuotaTontines(db, await lire(PRESIDENT))

    await db.update(users)
      .set({ planTier: 'standard', planUntil: new Date('2026-04-01T00:00:00Z') })
      .where(eq(users.id, PRESIDENT))
    await tontineActive('Une')
    await tontineActive('Deux')

    await verifierQuotaTontines(db, await lire(PRESIDENT), LE_5_MARS)
  })

  it('ne casse rien quand l’existant dépasse déjà le palier', async () => {
    // Le cas de la rétrogradation : un président repasse au gratuit avec trois
    // tontines en cours. Une tontine rotative est un cycle fermé — couper
    // l'écran au tour 6 sur 12 ne suspend rien dans la réalité, ça ne fait que
    // rendre le registre faux. Les trois continuent donc, seule l'ouverture
    // d'une quatrième est refusée.
    const encours = [await tontineActive('Une'), await tontineActive('Deux'), await tontineActive('Trois')]

    const etat = await etatAbonnement(db, await lire(PRESIDENT))
    expect(etat.auDessus).toBe(true)
    expect(etat.consommation.tontinesActives).toBe(3)
    expect(etat.consommation.tontines).toHaveLength(3)

    for (const id of encours) {
      const [t] = await db.select().from(tontines).where(eq(tontines.id, id)).limit(1)
      expect(t!.status).toBe('running')
    }

    await expect(verifierQuotaTontines(db, await lire(PRESIDENT))).rejects.toThrow(
      expect.objectContaining({ statusCode: 403 }),
    )
  })
})

describe('quota de membres', () => {
  it('compte toute adhésion sauf celles qui sont parties', async () => {
    const t = await tontineActive('Tontine')
    await remplir(t, 4)
    expect(await effectifDe(db, t)).toBe(4)

    const [dernier] = (await db
      .select()
      .from(memberships)
      .where(eq(memberships.tontineId, t)))
      .slice(-1)
    await db.update(memberships).set({ status: 'left' }).where(eq(memberships.id, dernier!.id))

    // Une place rendue redevient disponible ; un membre en défaut, non — il est
    // toujours dans le groupe.
    expect(await effectifDe(db, t)).toBe(3)
  })

  it('refuse le seizième membre au palier gratuit', async () => {
    const t = await tontineActive('Tontine pleine')
    await remplir(t, PALIER_PAR_ID.free.membresParTontine!)

    expect(await placeDisponible(db, t)).toBe(false)
    await expect(verifierQuotaMembres(db, t)).rejects.toThrow(
      expect.objectContaining({ statusCode: 403, statusMessage: 'PLAN_LIMIT' }),
    )
  })

  it('s’applique au palier du président, pas à celui de l’arrivant', async () => {
    await db.update(users)
      .set({ planTier: 'standard', planUntil: new Date('2026-04-01T00:00:00Z') })
      .where(eq(users.id, PRESIDENT))

    const t = await tontineActive('Tontine du président abonné')
    await remplir(t, 20)

    // 20 membres : au-dessus du gratuit, sous le Standard. C'est le palier du
    // président qui tranche — l'arrivant ne paie pas la tontine qu'il rejoint.
    await verifierQuotaMembres(db, t, 1, LE_5_MARS)
  })
})

describe('invitation — le lien cesse d’être partageable quand le groupe est plein', () => {
  it('annonce un groupe complet dans l’aperçu public', async () => {
    const t = await tontineActive('Tontine pleine')
    const { token } = await creerInvitation(db, t, PRESIDENT)
    await remplir(t, PALIER_PAR_ID.free.membresParTontine!)

    const apercu = await apercuInvitation(db, token)
    // L'arrivant lit « complet », jamais « le président n'a pas payé » :
    // l'abonnement de quelqu'un d'autre ne le regarde pas.
    expect(apercu.complet).toBe(true)
    expect(JSON.stringify(apercu)).not.toContain('palier')
  })

  it('refuse un nouvel arrivant une fois la limite atteinte', async () => {
    // `open` et non `running` : une tontine démarrée n'accueille de toute façon
    // plus personne — sa rotation est figée. C'est bien le quota qu'on éprouve
    // ici, pas ce refus-là.
    const t = await tontineActive('Tontine pleine', 'open')
    const { token } = await creerInvitation(db, t, PRESIDENT)
    await remplir(t, PALIER_PAR_ID.free.membresParTontine!)

    await expect(accepterInvitation(db, token, ARRIVANT)).rejects.toThrow(
      expect.objectContaining({ statusCode: 403, statusMessage: 'PLAN_LIMIT' }),
    )
  })

  it('laisse malgré tout un membre géré rattacher son compte', async () => {
    // Il occupe déjà son siège : le rattachement n'ajoute personne, il relie un
    // compte à une adhésion existante. Le refuser dédoublerait son historique
    // ou le laisserait dehors alors qu'il cotise depuis des mois.
    const t = await tontineActive('Tontine pleine')
    await remplir(t, PALIER_PAR_ID.free.membresParTontine! - 1)
    await ajouterMembreGere(db, t, { name: 'Yao Brou', phone: '+2250707000002', shares: 1 })
    expect(await effectifDe(db, t)).toBe(PALIER_PAR_ID.free.membresParTontine)

    const { token } = await creerInvitation(db, t, PRESIDENT)
    const resultat = await accepterInvitation(db, token, ARRIVANT)

    expect(resultat.rattache).toBe(true)
    expect(await effectifDe(db, t)).toBe(PALIER_PAR_ID.free.membresParTontine)
  })
})

describe('demande de passage', () => {
  it('fige le prix de la grille, jamais celui du client', async () => {
    const mensuelle = await creerDemande(db, PRESIDENT, { tier: 'standard', periodicity: 'monthly' })
    expect(mensuelle.priceFcfa).toBe(PALIER_PAR_ID.standard.prixMensuel)

    const [ligne] = await db.select().from(subscriptionRequests).where(eq(subscriptionRequests.id, mensuelle.id))
    expect(ligne!.priceFcfa).toBe(7_500)
  })

  it('applique les deux mois offerts sur l’année', async () => {
    const annuelle = await creerDemande(db, PRESIDENT, { tier: 'plus', periodicity: 'yearly' })
    expect(annuelle.priceFcfa).toBe(PALIER_PAR_ID.plus.prixAnnuel)
    expect(annuelle.priceFcfa).toBe(PALIER_PAR_ID.plus.prixMensuel * 10)
  })

  it('n’en accepte qu’une à la fois', async () => {
    await creerDemande(db, PRESIDENT, { tier: 'standard', periodicity: 'monthly' })

    await expect(creerDemande(db, PRESIDENT, { tier: 'plus', periodicity: 'monthly' })).rejects.toThrow(
      expect.objectContaining({ statusCode: 409 }),
    )
    expect(await demandesEnAttente(db)).toHaveLength(1)
  })
})

describe('décision du back-office', () => {
  it('pose le palier, l’échéance, la trace et la notification', async () => {
    const demande = await creerDemande(db, PRESIDENT, { tier: 'standard', periodicity: 'monthly' })
    const resultat = await approuverDemande(db, demande.id, ADMIN, LE_5_MARS)

    expect(resultat.tier).toBe('standard')
    expect(resultat.planUntil.toISOString().slice(0, 10)).toBe('2026-04-05')
    expect((await lire(PRESIDENT)).planTier).toBe('standard')

    // La décision lève un quota : elle doit avoir un signataire.
    const journal = await db.select().from(adminAudit)
    expect(journal).toHaveLength(1)
    expect(journal[0]!.action).toBe('abonnement_approuve')
    expect(journal[0]!.actorPhone).toBe(ADMIN.phone)

    // Règle 21 : la notification s'affiche sur un écran verrouillé.
    const [notif] = await db.select().from(notifications).where(eq(notifications.userId, PRESIDENT))
    expect(notif!.body).not.toMatch(/FCFA|\d{4}/)
  })

  it('prolonge les droits en cours quand le palier ne change pas', async () => {
    await db.update(users)
      .set({ planTier: 'standard', planUntil: new Date('2026-04-01T00:00:00Z') })
      .where(eq(users.id, PRESIDENT))

    const demande = await creerDemande(db, PRESIDENT, { tier: 'standard', periodicity: 'monthly' })
    const { planUntil } = await approuverDemande(db, demande.id, ADMIN, LE_5_MARS)

    // Renouveler ne fait pas perdre les jours restants.
    expect(planUntil.toISOString().slice(0, 10)).toBe('2026-05-01')
  })

  it('repart de maintenant quand le palier change', async () => {
    await db.update(users)
      .set({ planTier: 'standard', planUntil: new Date('2026-04-01T00:00:00Z') })
      .where(eq(users.id, PRESIDENT))

    const demande = await creerDemande(db, PRESIDENT, { tier: 'plus', periodicity: 'yearly' })
    const { planUntil } = await approuverDemande(db, demande.id, ADMIN, LE_5_MARS)

    expect(planUntil.toISOString().slice(0, 10)).toBe('2027-03-05')
  })

  it('ne garde pas le quantième d’un mois plus court', async () => {
    const le31 = new Date('2026-01-31T10:00:00Z')
    const demande = await creerDemande(db, PRESIDENT, { tier: 'standard', periodicity: 'monthly' })
    const { planUntil } = await approuverDemande(db, demande.id, ADMIN, le31)

    // Sans repli sur le dernier jour, `setMonth` ferait glisser au 3 mars et
    // l'échéance dériverait d'un mois sur l'autre.
    expect(planUntil.toISOString().slice(0, 7)).toBe('2026-02')
  })

  it('ne se rejoue pas : une demande décidée est définitive', async () => {
    const demande = await creerDemande(db, PRESIDENT, { tier: 'standard', periodicity: 'monthly' })
    await approuverDemande(db, demande.id, ADMIN, LE_5_MARS)

    await expect(approuverDemande(db, demande.id, ADMIN, LE_5_MARS)).rejects.toThrow(
      expect.objectContaining({ statusCode: 409, statusMessage: 'INVALID_TRANSITION' }),
    )
    await expect(rejeterDemande(db, demande.id, ADMIN, 'Règlement non constaté')).rejects.toThrow(
      expect.objectContaining({ statusCode: 409 }),
    )
  })

  it('exige un motif au refus, et le rend lisible par la personne', async () => {
    const demande = await creerDemande(db, PRESIDENT, { tier: 'plus', periodicity: 'monthly' })

    await expect(rejeterDemande(db, demande.id, ADMIN, ' ')).rejects.toThrow(
      expect.objectContaining({ statusCode: 422 }),
    )

    await rejeterDemande(db, demande.id, ADMIN, 'Règlement non constaté à ce jour.')

    const etat = await etatAbonnement(db, await lire(PRESIDENT))
    expect(etat.demandeEnCours).toBeNull()
    expect((await lire(PRESIDENT)).planTier).toBe('free')

    const [ligne] = await db.select().from(subscriptionRequests).where(eq(subscriptionRequests.id, demande.id))
    expect(ligne!.reviewNote).toBe('Règlement non constaté à ce jour.')
  })
})
