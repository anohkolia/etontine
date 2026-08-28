import { and, asc, eq, inArray, lte } from 'drizzle-orm'
import type { useDb } from '../db/index.ts'
import { contributions, rounds, tontines } from '../db/schema.ts'
import { assertTransition } from '../utils/transitions.ts'

type Db = ReturnType<typeof useDb>

/** Le jour courant en `AAAA-MM-JJ`, dans le fuseau du serveur. */
function jour(decalageJours = 0): string {
  return new Date(Date.now() + decalageJours * 86_400_000).toISOString().slice(0, 10)
}

/**
 * Passe les cotisations de `due` à `late`, une fois le délai de grâce dépassé.
 *
 * Le délai de grâce n'est pas une tolérance molle : c'est ce qui évite de
 * traiter de retardataire quelqu'un qui envoie son argent le lendemain du jour
 * dit. Marquer trop tôt use la relance, et fait désinstaller l'application.
 *
 * **Idempotent** : relancer ne change rien à ce qui est déjà marqué, et une
 * exécution manquée se rattrape à la suivante.
 */
export function marquerRetards(db: Db, maintenant: Date = new Date()): number {
  const enCours = db
    .select({ id: tontines.id, graceDays: tontines.graceDays })
    .from(tontines)
    .where(eq(tontines.status, 'running'))
    .all()

  let marquees = 0

  for (const tontine of enCours) {
    // Le délai de grâce est propre à chaque tontine.
    const limite = new Date(maintenant.getTime() - tontine.graceDays * 86_400_000)
      .toISOString()
      .slice(0, 10)

    const tours = db
      .select({ id: rounds.id })
      .from(rounds)
      .where(and(eq(rounds.tontineId, tontine.id), eq(rounds.status, 'collecting')))
      .all()

    if (tours.length === 0) continue

    const aMarquer = db
      .select({ id: contributions.id, status: contributions.status })
      .from(contributions)
      .where(and(
        inArray(contributions.roundId, tours.map(t => t.id)),
        eq(contributions.status, 'due'),
        lte(contributions.dueDate, limite),
      ))
      .all()

    for (const c of aMarquer) {
      // Même dans une tâche, la transition passe par la machine à états :
      // aucun chemin d'écriture ne doit la contourner.
      assertTransition('contribution', c.status, 'late')
      db.update(contributions).set({ status: 'late' }).where(eq(contributions.id, c.id)).run()
      marquees++
    }
  }

  return marquees
}

/**
 * Ouvre à la cotisation les tours dont la date est arrivée.
 *
 * Les tours sont tous créés au démarrage, mais **un seul est ouvert à la
 * fois** : afficher « à cotiser » sur six tours simultanément rendrait l'écran
 * illisible, et ferait payer d'avance des gens qui n'ont rien demandé.
 *
 * Un tour ne s'ouvre donc que si aucun autre n'est en cours. Sans cette
 * condition, un retard de versement laisserait deux tours ouverts en
 * parallèle : les cotisations des deux se mélangeraient sur le même canal de
 * collecte, et plus personne ne saurait à quel pot appartient quel envoi.
 */
export function ouvrirTourSuivant(db: Db, maintenant: Date = new Date()): number {
  const aujourdhui = maintenant.toISOString().slice(0, 10)

  const enCours = db
    .select({ id: tontines.id })
    .from(tontines)
    .where(eq(tontines.status, 'running'))
    .all()

  let ouverts = 0

  for (const tontine of enCours) {
    const dejaOuvert = db
      .select({ id: rounds.id })
      .from(rounds)
      .where(and(
        eq(rounds.tontineId, tontine.id),
        inArray(rounds.status, ['collecting', 'payout_pending']),
      ))
      .all()

    if (dejaOuvert.length > 0) continue

    const [suivant] = db
      .select()
      .from(rounds)
      .where(and(
        eq(rounds.tontineId, tontine.id),
        eq(rounds.status, 'pending'),
        lte(rounds.dueDate, aujourdhui),
      ))
      .orderBy(asc(rounds.index))
      .limit(1)
      .all()

    if (!suivant) continue

    assertTransition('round', suivant.status, 'collecting')
    db.update(rounds).set({ status: 'collecting' }).where(eq(rounds.id, suivant.id)).run()
    ouverts++
  }

  return ouverts
}

export { jour }
