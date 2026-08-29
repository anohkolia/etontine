/**
 * Seed de développement — rejouable.
 *
 * Compose exactement le jeu demandé par le ticket T04 : **une tontine de six
 * membres dont un à double part**, trois tours, et des statuts variés pour que
 * chaque écran ait de quoi s'afficher sans qu'on ait à cliquer une heure.
 *
 * Le membre à double part n'est pas un détail de confort : c'est la source
 * d'erreur n°1 du modèle. Avoir en permanence, dans les données de
 * développement, quelqu'un qui occupe deux positions et cotise deux fois par
 * tour, c'est ce qui fait tomber les régressions tôt.
 *
 * Rejouable : le seed efface d'abord ce qu'il a créé, en repartant des mêmes
 * identifiants fixes. `pnpm db:seed` deux fois de suite donne le même état.
 */
import { existsSync } from 'node:fs'
import { eq, inArray } from 'drizzle-orm'
import { useDb } from './index.ts'
import * as t from './schema.ts'

// Même raison que pour `cli.ts` : un script Node ordinaire ne lit pas `.env`,
// et le seed doit viser la même base que le serveur.
if (existsSync('.env')) process.loadEnvFile('.env')

const db = useDb()

/**
 * Identifiants fixes : c'est ce qui rend le seed rejouable et déboguable.
 *
 * Ce sont de vrais UUID, et pas des chaînes lisibles comme `seed-u-aya` : les
 * schémas Zod partagés valident les identifiants avec `z.string().uuid()`, et
 * un identifiant non conforme rendrait la moitié des points d'entrée
 * inutilisables en développement. Le préfixe `5eed…` les rend reconnaissables
 * d'un coup d'œil dans une trace.
 */
const ID = {
  tontine: '5eed0000-0000-4000-8000-000000000001',
  users: [
    '5eed0000-0000-4000-8000-000000000101',
    '5eed0000-0000-4000-8000-000000000102',
    '5eed0000-0000-4000-8000-000000000103',
    '5eed0000-0000-4000-8000-000000000104',
    '5eed0000-0000-4000-8000-000000000105',
    '5eed0000-0000-4000-8000-000000000106',
  ],
  channel: '5eed0000-0000-4000-8000-000000000201',
} as const

const MEMBRES = [
  { id: ID.users[0], firstName: 'Aya', lastName: 'Koné', phone: '+2250707000001', role: 'president' as const, parts: 1 },
  { id: ID.users[1], firstName: 'Koffi', lastName: 'N’Guessan', phone: '+2250707000002', role: 'treasurer' as const, parts: 1 },
  { id: ID.users[2], firstName: 'Fatou', lastName: 'Diarra', phone: '+2250707000003', role: 'auditor' as const, parts: 1 },
  // Le double part. Il occupe deux positions et cotise deux fois par tour.
  { id: ID.users[3], firstName: 'Yao', lastName: 'Brou', phone: '+2250707000004', role: 'member' as const, parts: 2 },
  { id: ID.users[4], firstName: 'Mariam', lastName: 'Touré', phone: '+2250707000005', role: 'member' as const, parts: 1 },
  // Membre géré : pas de compte, le trésorier déclare pour lui (T16).
  { id: ID.users[5], firstName: 'Ibrahim', lastName: 'Sanogo', phone: '+2250707000006', role: 'member' as const, parts: 1, gere: true },
]

const MONTANT_PART = 25_000
const TOTAL_PARTS = MEMBRES.reduce((n, m) => n + m.parts, 0) // 7
const POT_ATTENDU = MONTANT_PART * TOTAL_PARTS // 175 000 FCFA

/**
 * Fabrique un UUID stable à partir d'une famille et de deux indices. Stable
 * d'une exécution à l'autre : c'est ce qui permet au seed d'être rejouable et
 * aux tests de bout en bout de viser un identifiant connu.
 */
function derive(famille: string, a: number, b: number): string {
  const suffixe = `${famille}${String(a).padStart(3, '0')}${String(b).padStart(3, '0')}`
  return `5eed0000-0000-4000-8000-${suffixe.padStart(12, '0')}`
}

function jour(decalage: number): string {
  const d = new Date()
  d.setDate(d.getDate() + decalage)
  return d.toISOString().slice(0, 10)
}

function nettoyer() {
  // Le nettoyage vise le **numéro de téléphone**, pas l'identifiant : le
  // numéro est la clé métier stable, alors qu'un identifiant de seed peut
  // changer. Nettoyer par identifiant laisserait des utilisateurs orphelins
  // dont le numéro bloquerait la réinsertion sur la contrainte d'unicité —
  // ce qui est exactement arrivé la première fois.
  const telephones = MEMBRES.map(m => m.phone)

  const anciens = db
    .select({ id: t.users.id })
    .from(t.users)
    .where(inArray(t.users.phone, telephones))
    .all()

  // L'effacement part des tontines : le reste suit en cascade.
  db.delete(t.tontines).where(eq(t.tontines.id, ID.tontine)).run()
  for (const u of anciens) {
    db.delete(t.tontines).where(eq(t.tontines.createdBy, u.id)).run()
  }
  db.delete(t.users).where(inArray(t.users.phone, telephones)).run()
}

function semer() {
  const maintenant = new Date()

  for (const m of MEMBRES) {
    // Le membre géré n'a pas encore de compte : on ne crée son utilisateur que
    // s'il en a un. C'est le cas réel à traiter en T12.
    if (m.gere) continue
    db.insert(t.users).values({
      id: m.id,
      phone: m.phone,
      firstName: m.firstName,
      lastName: m.lastName,
      kycLevel: m.role === 'president' ? 2 : 1,
      createdAt: maintenant,
    }).run()
  }

  db.insert(t.collectionChannels).values({
    id: ID.channel,
    userId: ID.users[0],
    provider: 'wave',
    msisdn: '+2250707000001',
    holderName: 'Aya Koné',
    verifiedAt: maintenant,
  }).run()

  db.insert(t.tontines).values({
    id: ID.tontine,
    name: 'Tontine des tantines',
    description: 'Tontine mensuelle du quartier.',
    locality: 'Abobo',
    access: 'private',
    shareAmount: MONTANT_PART,
    frequency: 'monthly',
    startDate: jour(-60),
    rotationMode: 'fixed',
    feesBearer: 'member',
    penaltyAmount: 2_000,
    penaltyPeriod: 'once',
    graceDays: 3,
    status: 'running',
    createdBy: ID.users[0],
    rotationFrozenAt: maintenant,
  }).run()

  db.insert(t.tontineChannels).values({
    tontineId: ID.tontine,
    channelId: ID.channel,
  }).run()

  // Memberships, puis parts. Une part = une position dans la rotation.
  let position = 1
  const partsParMembre: Array<{ membershipId: string, shareIds: string[], nom: string }> = []

  for (const m of MEMBRES) {
    const membershipId = derive('a', MEMBRES.indexOf(m), 0)
    db.insert(t.memberships).values({
      id: membershipId,
      tontineId: ID.tontine,
      userId: m.gere ? null : m.id,
      managedName: m.gere ? `${m.firstName} ${m.lastName}` : null,
      managedPhone: m.gere ? m.phone : null,
      role: m.role,
      status: 'active',
      joinedAt: maintenant,
    }).run()

    const shareIds: string[] = []
    for (let i = 0; i < m.parts; i++) {
      const shareId = derive('b', MEMBRES.indexOf(m), i)
      db.insert(t.shares).values({
        id: shareId,
        tontineId: ID.tontine,
        membershipId,
        rotationPosition: position++,
      }).run()
      shareIds.push(shareId)
    }
    partsParMembre.push({ membershipId, shareIds, nom: `${m.firstName} ${m.lastName}` })
  }

  const toutesLesParts = partsParMembre.flatMap(p =>
    p.shareIds.map(id => ({ shareId: id, membershipId: p.membershipId })),
  )

  /**
   * Trois tours aux statuts contrastés :
   * 1. clos — tout confirmé, pot versé et accusé de réception ;
   * 2. en cours — le mélange réaliste : confirmé, déclaré, en retard, dû ;
   * 3. à venir — rien n'est encore ouvert.
   */
  const tours = [
    { index: 1, statut: 'closed' as const, echeance: jour(-30) },
    { index: 2, statut: 'collecting' as const, echeance: jour(-1) },
    { index: 3, statut: 'pending' as const, echeance: jour(29) },
  ]

  for (const tour of tours) {
    const roundId = derive('c', tour.index, 0)
    const beneficiaire = toutesLesParts[tour.index - 1]!

    db.insert(t.rounds).values({
      id: roundId,
      tontineId: ID.tontine,
      index: tour.index,
      dueDate: tour.echeance,
      beneficiaryShareId: beneficiaire.shareId,
      expectedAmount: POT_ATTENDU,
      status: tour.statut,
      closedAt: tour.statut === 'closed' ? maintenant : null,
    }).run()

    toutesLesParts.forEach((part, i) => {
      // Le bénéficiaire du tour cotise **aussi** : ne pas l'exclure.
      const statut = statutDeCotisation(tour.statut, i)
      db.insert(t.contributions).values({
        id: derive('d', tour.index, i),
        roundId,
        shareId: part.shareId,
        membershipId: part.membershipId,
        expectedAmount: MONTANT_PART,
        confirmedAmount: statut === 'confirmed' ? MONTANT_PART : 0,
        status: statut,
        dueDate: tour.echeance,
      }).run()
    })

    if (tour.statut === 'closed') {
      db.insert(t.payouts).values({
        id: derive('e', tour.index, 0),
        roundId,
        beneficiaryMembershipId: beneficiaire.membershipId,
        amount: POT_ATTENDU,
        channel: 'wave',
        preparedBy: ID.users[1],
        counterValidatedBy: ID.users[0],
        declaredBy: ID.users[1],
        acknowledgedAt: maintenant,
        status: 'acknowledged',
      }).run()
    }
  }
}

/** Statuts variés sur le tour en cours, pour que chaque écran ait de la matière. */
function statutDeCotisation(statutTour: 'closed' | 'collecting' | 'pending', i: number) {
  if (statutTour === 'closed') return 'confirmed' as const
  if (statutTour === 'pending') return 'due' as const

  // Tour en cours : 3 confirmées, 1 déclarée en attente, 1 en retard, 2 dues.
  const grille = ['confirmed', 'confirmed', 'confirmed', 'declared', 'late', 'due', 'due'] as const
  return grille[i] ?? 'due'
}

nettoyer()
semer()

console.log(
  `Seed posé : « Tontine des tantines » — ${MEMBRES.length} membres, `
  + `${TOTAL_PARTS} parts (Yao Brou en a deux), 3 tours, `
  + `pot attendu ${POT_ATTENDU} FCFA par tour.`,
)
