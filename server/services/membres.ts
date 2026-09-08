import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray, ne } from 'drizzle-orm'
import type { useDb } from '../db/index.ts'
import { contributions, memberships, rounds, shares, tontines, users } from '../db/schema.ts'
import type { MembershipRole } from '../../shared/schemas/index.ts'
import { apiError } from '../utils/errors.ts'
import { assertTransition } from '../utils/transitions.ts'
import { appendLedger } from './ledger.ts'
import { genererGraine, melangerAvecGraine } from './rotation.ts'

type Db = ReturnType<typeof useDb>

/**
 * Ajoute un membre géré : quelqu'un qui n'a pas l'application.
 *
 * C'est le cas le plus fréquent au démarrage — la tontine existe déjà hors
 * ligne, et le bureau saisit le groupe tel quel. Le membre reçoit ensuite un
 * SMS de confirmation ; jusque-là, `user_id` reste nul.
 */
export function ajouterMembreGere(db: Db, tontineId: string, input: {
  name: string
  phone: string
  shares: number
}) {
  const membershipId = randomUUID()

  db.insert(memberships).values({
    id: membershipId,
    tontineId,
    userId: null,
    managedName: input.name,
    managedPhone: input.phone,
    role: 'member',
    status: 'active',
    joinedAt: new Date(),
  }).run()

  attribuerParts(db, tontineId, membershipId, input.shares)
  return membershipId
}

/**
 * Attribue `nombre` parts à une adhésion.
 *
 * **Une part = une position dans la rotation = un tour où l'on prend la main.**
 * Un membre à double part possède donc deux lignes, à deux positions
 * distinctes. Toute la logique de rotation raisonne sur `shares`, jamais sur
 * `memberships` : c'est la source d'erreur n°1 du modèle, et la contourner
 * casse à la fois l'ordre de passage et le calcul du pot.
 */
export function attribuerParts(db: Db, tontineId: string, membershipId: string, nombre: number) {
  if (nombre < 1) throw apiError('VALIDATION_ERROR', 'Un membre a au moins une part.', { field: 'shares' })

  const existantes = db
    .select()
    .from(shares)
    .where(eq(shares.membershipId, membershipId))
    .all()

  if (existantes.length === nombre) return

  if (nombre < existantes.length) {
    // On retire les parts les plus récentes, pas les plus anciennes : la
    // position acquise en premier est celle qui compte.
    const aRetirer = existantes.slice(nombre).map(s => s.id)
    db.delete(shares).where(inArray(shares.id, aRetirer)).run()
    return
  }

  const toutes = db.select().from(shares).where(eq(shares.tontineId, tontineId)).all()
  let position = Math.max(0, ...toutes.map(s => s.rotationPosition))

  for (let i = existantes.length; i < nombre; i++) {
    position++
    db.insert(shares).values({
      id: randomUUID(),
      tontineId,
      membershipId,
      rotationPosition: position,
    }).run()
  }
}

/** Les parts d'une tontine, dans l'ordre de rotation. */
export function rotationDe(db: Db, tontineId: string) {
  return db
    .select({
      shareId: shares.id,
      rotationPosition: shares.rotationPosition,
      membershipId: memberships.id,
      userId: memberships.userId,
      managedName: memberships.managedName,
      firstName: users.firstName,
      lastName: users.lastName,
      role: memberships.role,
      status: memberships.status,
    })
    .from(shares)
    .innerJoin(memberships, eq(memberships.id, shares.membershipId))
    .leftJoin(users, eq(users.id, memberships.userId))
    .where(eq(shares.tontineId, tontineId))
    .orderBy(asc(shares.rotationPosition))
    .all()
    .map(p => ({
      ...p,
      // L'écran d'ordre de passage nomme des personnes : sans le compte, une
      // ligne arrivée par lien n'aurait aucun nom à afficher.
      nom: [p.firstName, p.lastName].filter(Boolean).join(' ') || p.managedName || 'Membre',
    }))
}

/**
 * Les membres d'une tontine, avec leur nombre de parts et leurs positions.
 *
 * Le nom et le numéro viennent du compte quand il y en a un, et de la saisie
 * du bureau sinon. Les prendre uniquement dans `managed_*` affichait « Membre
 * inscrit », sans numéro, pour quiconque était arrivé par lien — c'est-à-dire
 * précisément les personnes sur lesquelles le président doit se prononcer.
 */
export function membresDe(db: Db, tontineId: string) {
  const parts = rotationDe(db, tontineId)
  const lignes = db
    .select({
      membership: memberships,
      firstName: users.firstName,
      lastName: users.lastName,
      userPhone: users.phone,
    })
    .from(memberships)
    .leftJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.tontineId, tontineId))
    .all()

  return lignes.map(({ membership: m, firstName, lastName, userPhone }) => ({
    id: m.id,
    userId: m.userId,
    name: [firstName, lastName].filter(Boolean).join(' ') || m.managedName,
    phone: m.managedPhone ?? userPhone,
    role: m.role,
    status: m.status,
    /** Un membre à double part apparaît deux fois dans la rotation. */
    positions: parts.filter(p => p.membershipId === m.id).map(p => p.rotationPosition),
    shares: parts.filter(p => p.membershipId === m.id).length,
    // Ce qu'une sortie laisserait derrière : le montrer **avant** de faire
    // sortir quelqu'un, pas après.
    resteDu: resteDu(db, m.id),
  }))
}

export interface ResultatRotation {
  mode: 'fixed' | 'draw'
  seed: string | null
  order: string[]
}

/**
 * Fixe l'ordre de passage.
 *
 * En mode `draw`, **le tirage est fait ici, côté serveur**, et sa graine est
 * inscrite au registre avec le résultat. C'est la preuve anti-soupçon : un
 * membre qui doute rejoue la graine et retrouve le même ordre. Un tirage côté
 * client serait invérifiable, donc contestable — et le premier à passer est
 * toujours suspecté d'avoir arrangé le résultat.
 */
export function definirRotation(
  db: Db,
  tontineId: string,
  acteurId: string,
  input: { mode: 'fixed' | 'draw', order?: string[] },
): ResultatRotation {
  const [tontine] = db.select().from(tontines).where(eq(tontines.id, tontineId)).limit(1).all()
  if (!tontine) throw apiError('NOT_FOUND', 'Tontine introuvable.')

  if (tontine.rotationFrozenAt) {
    throw apiError(
      'FORBIDDEN',
      'L’ordre de passage est figé depuis le démarrage. Il faut une contre-validation du censeur pour le changer.',
      { field: 'rotation' },
    )
  }

  const parts = db.select().from(shares).where(eq(shares.tontineId, tontineId)).all()
  if (parts.length === 0) {
    throw apiError('VALIDATION_ERROR', 'Aucune part à ordonner.', { field: 'shares' })
  }

  // La liste de départ est **triée**, et c'est structurant : c'est elle qui sera
  // inscrite au registre. Mélanger la liste dans l'ordre où la base l'a rendue,
  // puis en consigner une version triée, donnerait une preuve invérifiable —
  // rejouer la graine sur la liste consignée tomberait sur un autre ordre.
  const idsDeDepart = parts.map(p => p.id).sort()

  let ordre: string[]
  let graine: string | null = null

  if (input.mode === 'draw') {
    graine = genererGraine()
    ordre = melangerAvecGraine(idsDeDepart, graine)
  }
  else {
    const fourni = input.order ?? []
    const connues = new Set(parts.map(p => p.id))

    if (fourni.length !== parts.length || !fourni.every(id => connues.has(id))) {
      throw apiError(
        'VALIDATION_ERROR',
        'L’ordre fourni doit contenir chaque part exactement une fois.',
        { field: 'order' },
      )
    }
    ordre = fourni
  }

  ordre.forEach((shareId, index) => {
    // Positions temporaires négatives d'abord : sans cela, réordonner heurte
    // la contrainte d'unicité `(tontine_id, rotation_position)` en cours de route.
    db.update(shares).set({ rotationPosition: -(index + 1) }).where(eq(shares.id, shareId)).run()
  })
  ordre.forEach((shareId, index) => {
    db.update(shares).set({ rotationPosition: index + 1 }).where(eq(shares.id, shareId)).run()
  })

  db.update(tontines).set({ rotationMode: input.mode }).where(eq(tontines.id, tontineId)).run()

  appendLedger(db, {
    tontineId,
    type: 'rotation_changed',
    actorId: acteurId,
    payload: {
      mode: input.mode,
      // La graine **et** le résultat : l'un sans l'autre ne prouve rien.
      seed: graine,
      order: ordre,
      sharesAtDraw: idsDeDepart,
    },
  })

  return { mode: input.mode, seed: graine, order: ordre }
}

/** Change le rôle d'un membre dans la tontine. Le rôle est par tontine. */
export function definirRole(db: Db, membershipId: string, role: MembershipRole) {
  db.update(memberships).set({ role }).where(eq(memberships.id, membershipId)).run()
}

/**
 * Ce qu'un membre doit encore, sur les tours qui ne sont pas clos.
 *
 * Le calcul vit ici parce que deux écrans en ont besoin — la liste des membres,
 * pour dire ce qu'une sortie laisserait derrière elle, et la sortie elle-même,
 * qui l'inscrit au registre. Le recopier serait deux calculs d'argent dont rien
 * ne garantirait qu'ils disent la même chose.
 */
export function resteDu(db: Db, membershipId: string): number {
  return db
    .select({
      expected: contributions.expectedAmount,
      confirmed: contributions.confirmedAmount,
    })
    .from(contributions)
    .innerJoin(rounds, eq(rounds.id, contributions.roundId))
    .where(and(
      eq(contributions.membershipId, membershipId),
      ne(rounds.status, 'closed'),
    ))
    .all()
    .reduce((n, c) => n + Math.max(0, c.expected - c.confirmed), 0)
}

/**
 * Fait sortir un membre, **et dit ce qu'il laisse derrière lui**.
 *
 * Le contrat annonçait « sortie avec calcul de ce qui est dû » ; la sortie
 * était muette. Une adhésion qui disparaît sans chiffre, c'est le groupe qui
 * découvre le trou au tour suivant, sans trace de qui devait quoi au moment du
 * départ. Le montant part donc au registre avec la sortie.
 *
 * Le président ne peut pas sortir : la tontine perdrait son seul rôle capable
 * de confirmer, de contre-valider et de clore. Il faudrait d'abord passer la
 * présidence, ce qui est un autre geste.
 */
export function retirerMembre(db: Db, membershipId: string, acteurId: string) {
  const [m] = db.select().from(memberships).where(eq(memberships.id, membershipId)).limit(1).all()
  if (!m) throw apiError('NOT_FOUND', 'Membre introuvable.')

  if (m.role === 'president') {
    throw apiError(
      'FORBIDDEN',
      'Le président ne peut pas quitter sa propre tontine. Passe d’abord la présidence à quelqu’un d’autre.',
      { field: 'role' },
    )
  }

  assertTransition('membership', m.status, 'left')

  const du = resteDu(db, membershipId)

  db.update(memberships).set({ status: 'left' }).where(eq(memberships.id, membershipId)).run()

  appendLedger(db, {
    tontineId: m.tontineId,
    type: 'member_left',
    // Celui qui **agit**, pas celui qui part. L'ancien repli sur l'identifiant
    // d'adhésion faisait échouer la sortie de tout membre géré : sans compte,
    // il n'existe pas dans `users`, et la clé étrangère du registre refusait
    // l'écriture. Retirer quelqu'un que le bureau avait saisi à la main —
    // c'est-à-dire le cas le plus courant — levait donc une erreur SQL.
    actorId: acteurId,
    payload: { membershipId, name: m.managedName, resteDu: du },
  })

  return { membershipId, resteDu: du }
}

/** Compte les adhésions actives — contrôle avant démarrage. */
export function comptesActifs(db: Db, tontineId: string): number {
  return db
    .select()
    .from(memberships)
    .where(and(eq(memberships.tontineId, tontineId), eq(memberships.status, 'active')))
    .all()
    .length
}
