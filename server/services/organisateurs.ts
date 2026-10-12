import { and, asc, count, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import type { useDb } from '../db/index.ts'
import { memberships, tontines, users } from '../db/schema.ts'
import type { User } from '../db/schema.ts'
import type { PlanTier } from '../../shared/constants/abonnement.ts'
import { numerosAdministrateurs } from '../utils/admin.ts'
import { apiError } from '../utils/errors.ts'
import { palierDe } from './abonnement.ts'
import { envoyerEmail, messages } from './email.ts'
import { journaliser } from './journal-admin.ts'
import type { Administrateur } from './journal-admin.ts'

type Db = ReturnType<typeof useDb>

export type { Administrateur }

/**
 * Les organisateurs — ceux qui viennent monter des tontines, et que le
 * back-office suit.
 *
 * On ne rejoint une tontine que par le lien de son organisateur : quelqu'un
 * qui s'inscrit **sans** lien vient donc en organiser une. Il est marqué dès
 * l'inscription (`users.organizerSince`), et les administrateurs sont alertés
 * quand son adresse est confirmée — avant, le compte n'existe pas vraiment, et
 * alerter sur une inscription jamais confirmée reviendrait à alerter sur le
 * premier venu qui tape le numéro d'un autre.
 *
 * Un compte venu d'une invitation, lui, ne devient organisateur qu'à sa
 * première tontine : c'est là qu'il change de nature, et c'est là que l'alerte
 * part.
 *
 * Ce n'est pas un rôle. Les droits restent par tontine (`memberships.role`) ;
 * être organisateur n'en ouvre aucun, c'est un fait que le back-office suit.
 */

/* ------------------------------------------------------------------ *
 * Alerte
 * ------------------------------------------------------------------ */

/**
 * Écrit à chaque administrateur qu'un organisateur vient d'arriver.
 *
 * Les destinataires sont les comptes de `NUXT_ADMIN_PHONES`, à leur adresse
 * **confirmée** : la liste blanche reste la seule source de « qui est
 * administrateur », sans seconde liste d'adresses à tenir à jour. Un
 * administrateur qui ne s'est jamais inscrit n'a pas d'adresse, et ne peut de
 * toute façon pas ouvrir le back-office.
 *
 * **Jamais bloquant.** L'alerte accompagne une inscription ou une création de
 * tontine : une panne du fournisseur d'e-mails ne doit faire échouer ni l'une
 * ni l'autre. L'arrivée reste de toute façon signalée dans le back-office tant
 * qu'un administrateur ne l'a pas prise en compte — l'e-mail est un rappel,
 * pas la seule trace.
 *
 * Renvoie le nombre d'e-mails partis.
 */
export async function alerterAdministrateurs(db: Db, organisateur: Pick<User, 'phone'>): Promise<number> {
  const numeros = numerosAdministrateurs()
  if (numeros.length === 0) return 0

  let envoyes = 0
  try {
    const destinataires = await db
      .select({ email: users.email })
      .from(users)
      .where(and(inArray(users.phone, numeros), isNotNull(users.emailVerifiedAt), isNotNull(users.email)))

    const message = messages.nouvelOrganisateur(organisateur.phone.slice(-4))

    for (const { email } of destinataires) {
      try {
        await envoyerEmail({ to: email!, ...message })
        envoyes++
      }
      catch (e) {
        // Ni l'adresse ni le numéro dans le journal : il est moins protégé que
        // la base, et l'arrivée reste visible au back-office.
        console.error(`[organisateurs] alerte non envoyée à un administrateur : ${(e as Error).message}`)
      }
    }
  }
  catch (e) {
    console.error(`[organisateurs] alerte impossible : ${(e as Error).message}`)
  }
  return envoyes
}

/**
 * Un compte devient organisateur — à la création de sa première tontine.
 *
 * Idempotent : un compte déjà organisateur ne change pas, et n'alerte pas une
 * seconde fois. La mise à jour ne porte que sur une ligne encore vierge, ce qui
 * départage deux créations simultanées sans double alerte.
 *
 * Renvoie `true` si c'est cet appel qui l'a fait organisateur.
 */
export async function promouvoirOrganisateur(db: Db, userId: string, maintenant = new Date()): Promise<boolean> {
  const promus = await db
    .update(users)
    .set({ organizerSince: maintenant })
    .where(and(eq(users.id, userId), isNull(users.organizerSince)))
    .returning({ phone: users.phone, emailVerifiedAt: users.emailVerifiedAt })

  const promu = promus[0]
  if (!promu) return false

  // Un compte jamais confirmé n'existe pas encore vraiment : l'alerte partira
  // à la confirmation de son adresse, comme pour une inscription directe.
  if (promu.emailVerifiedAt) await alerterAdministrateurs(db, promu)
  return true
}

/* ------------------------------------------------------------------ *
 * Back-office
 * ------------------------------------------------------------------ */

export interface Organisateur {
  userId: string
  phone: string
  email: string | null
  firstName: string | null
  lastName: string | null
  /** Depuis quand le compte organise : l'inscription, ou sa première tontine. */
  organizerSince: Date
  /** Quand un administrateur a pris connaissance de l'arrivée. Nul : encore signalée. */
  seenAt: Date | null
  kycStatus: User['kycStatus']
  kycLevel: number
  /** Le palier en vigueur, échéance comprise. */
  palier: PlanTier
  /** Les tontines qu'il préside, par avancement. */
  tontines: { brouillons: number, actives: number, terminees: number }
}

/** Organisateur au sens du back-office : marqué, et à l'adresse confirmée. */
function estOrganisateurConfirme() {
  return and(isNotNull(users.organizerSince), isNotNull(users.emailVerifiedAt))
}

/**
 * Les organisateurs, pour le back-office.
 *
 * `nouveaux` : ceux qu'aucun administrateur n'a encore pris en compte, du plus
 * ancien au plus récent — la même règle que la file des dossiers, pour que
 * personne ne s'enfonce dans la pile. Et **toute** la file, sans plafond : une
 * file tronquée cacherait les dernières arrivées derrière les plus anciennes,
 * c'est-à-dire précisément celles dont on vient d'être alerté.
 *
 * `tous` : du plus récent au plus ancien, plafonné — c'est un historique.
 */
export async function organisateurs(db: Db, etat: 'nouveaux' | 'tous', limiteHistorique = 200): Promise<Organisateur[]> {
  const requete = db
    .select()
    .from(users)
    .where(etat === 'nouveaux' ? and(estOrganisateurConfirme(), isNull(users.organizerSeenAt)) : estOrganisateurConfirme())
    .orderBy(etat === 'nouveaux' ? asc(users.organizerSince) : desc(users.organizerSince))
    .$dynamic()

  const lignes = etat === 'tous' ? await requete.limit(limiteHistorique) : await requete

  if (lignes.length === 0) return []

  // Les tontines présidées, comptées en une requête pour toute la page plutôt
  // qu'une par organisateur.
  const decompte = await db
    .select({ userId: memberships.userId, status: tontines.status, n: count() })
    .from(memberships)
    .innerJoin(tontines, eq(tontines.id, memberships.tontineId))
    .where(and(
      inArray(memberships.userId, lignes.map(l => l.id)),
      eq(memberships.role, 'president'),
      eq(memberships.status, 'active'),
    ))
    .groupBy(memberships.userId, tontines.status)

  return lignes.map((u) => {
    const siennes = decompte.filter(d => d.userId === u.id)
    const nombre = (statuts: string[]) => siennes
      .filter(d => statuts.includes(d.status))
      .reduce((total, d) => total + d.n, 0)

    return {
      userId: u.id,
      phone: u.phone,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      organizerSince: u.organizerSince!,
      seenAt: u.organizerSeenAt,
      kycStatus: u.kycStatus,
      kycLevel: u.kycLevel,
      palier: palierDe(u).id,
      tontines: {
        brouillons: nombre(['draft']),
        actives: nombre(['open', 'running']),
        terminees: nombre(['closed', 'archived']),
      },
    }
  })
}

/** Le nombre d'arrivées encore signalées — le badge de l'onglet. */
export async function nombreNouveauxOrganisateurs(db: Db): Promise<number> {
  const [ligne] = await db
    .select({ n: count() })
    .from(users)
    .where(and(estOrganisateurConfirme(), isNull(users.organizerSeenAt)))

  return ligne?.n ?? 0
}

/**
 * Un administrateur prend en compte l'arrivée d'un organisateur : l'alerte
 * tombe, et le geste est journalisé — une alerte qui disparaît doit avoir un
 * auteur, sans quoi personne ne sait si quelqu'un l'a vraiment lue.
 *
 * Une seule fois : la seconde tentative est refusée, et la mise à jour ne porte
 * que sur une alerte encore ouverte, ce qui départage deux administrateurs qui
 * cliquent ensemble.
 */
export async function prendreEnCompteOrganisateur(
  db: Db,
  userId: string,
  admin: Administrateur,
  maintenant = new Date(),
): Promise<{ userId: string, seenAt: Date }> {
  const [u] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), estOrganisateurConfirme()))
    .limit(1)

  if (!u) throw apiError('NOT_FOUND', 'Organisateur introuvable.')

  const pris = await db
    .update(users)
    .set({ organizerSeenAt: maintenant, organizerSeenBy: admin.id })
    .where(and(eq(users.id, userId), isNull(users.organizerSeenAt)))
    .returning({ id: users.id })

  if (pris.length === 0) {
    throw apiError('INVALID_TRANSITION', 'Cet organisateur a déjà été pris en compte.', { field: 'seenAt' })
  }

  await journaliser(db, admin, 'organisateur_pris_en_compte', userId, {})

  return { userId, seenAt: maintenant }
}
