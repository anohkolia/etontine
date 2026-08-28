import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq } from 'drizzle-orm'
import type { useDb } from '../db/index.ts'
import { ledgerEntries } from '../db/schema.ts'
import type { LedgerEntry, LedgerType } from '../db/schema.ts'
import { canonicalJson, sha256 } from '../utils/hash.ts'

type Db = ReturnType<typeof useDb>

export interface AppendLedgerInput {
  tontineId: string
  roundId?: string | null
  type: LedgerType
  /** Qui a agi. Jamais déduit du payload : c'est l'appelant authentifié. */
  actorId: string
  payload: Record<string, unknown>
  /** L'écriture annulée, si `type = 'reversal'`. */
  reversesId?: string | null
}

/**
 * Empreinte d'une écriture.
 *
 * `hash = sha256(prev_hash + type + actor_id + canonical_json(payload) + server_timestamp)`
 * — exactement la formule de docs/data-model.md §1.
 *
 * Deux détails qui décident de la solidité de la chaîne :
 *
 * - le JSON est **canonique** (clés triées). Sans cela, une bibliothèque qui
 *   réordonne les clés en relisant casserait la vérification sur des données
 *   pourtant intactes ;
 * - l'horodatage est haché en **secondes**, la précision effectivement stockée
 *   par SQLite. Hacher des millisecondes rendrait toute écriture invérifiable
 *   dès sa relecture.
 */
export function computeHash(input: {
  prevHash: string | null
  type: string
  actorId: string
  payload: unknown
  serverTimestamp: Date
}): string {
  return sha256([
    input.prevHash ?? '',
    input.type,
    input.actorId,
    canonicalJson(input.payload),
    String(Math.floor(input.serverTimestamp.getTime() / 1000)),
  ].join('|'))
}

/**
 * Ajoute une écriture au registre d'une tontine.
 *
 * **Append-only** (règle 3) : ce service est le seul chemin d'écriture, il n'y
 * a ni mise à jour ni suppression. Une écriture erronée se corrige par une
 * écriture `reversal` qui référence l'originale — la trace de l'erreur reste,
 * c'est tout l'intérêt d'un registre devant un groupe.
 *
 * L'horodatage vient de l'horloge **serveur**. Un `date` fourni dans le payload
 * client n'est jamais utilisé pour le chaînage : c'est ce qui empêche
 * d'antidater une cotisation.
 */
export function appendLedger(db: Db, input: AppendLedgerInput): LedgerEntry {
  // La position et le hachage précédent doivent être lus et écrits sans qu'une
  // autre écriture s'intercale. La transaction plus la contrainte d'unicité
  // `(tontine_id, position)` rendent la course impossible : au pire, la seconde
  // écriture échoue et l'appelant réessaie.
  return db.transaction((tx) => {
    const [precedente] = tx
      .select({ hash: ledgerEntries.hash, position: ledgerEntries.position })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.tontineId, input.tontineId))
      .orderBy(desc(ledgerEntries.position))
      .limit(1)
      .all()

    const prevHash = precedente?.hash ?? null
    const position = (precedente?.position ?? 0) + 1

    // Secondes pleines : c'est la précision que SQLite conservera.
    const serverTimestamp = new Date(Math.floor(Date.now() / 1000) * 1000)

    const hash = computeHash({
      prevHash,
      type: input.type,
      actorId: input.actorId,
      payload: input.payload,
      serverTimestamp,
    })

    const ligne = {
      id: randomUUID(),
      tontineId: input.tontineId,
      roundId: input.roundId ?? null,
      type: input.type,
      actorId: input.actorId,
      payload: input.payload,
      reversesId: input.reversesId ?? null,
      prevHash,
      hash,
      position,
      serverTimestamp,
    }

    tx.insert(ledgerEntries).values(ligne).run()
    return ligne as LedgerEntry
  })
}

export interface LedgerVerification {
  valid: boolean
  /** Position de la première écriture en défaut, 1..n. */
  brokenAt?: number
  /** Ce qui cloche, en clair : sert au message affiché au bureau. */
  reason?: string
  entriesChecked: number
}

/**
 * Rejoue la chaîne d'une tontine et signale la **première** rupture.
 *
 * Trois défauts sont détectés :
 * 1. une écriture modifiée après coup — son empreinte ne correspond plus ;
 * 2. un maillon décroché — le `prev_hash` ne pointe pas sur l'écriture d'avant ;
 * 3. un trou dans les positions — une écriture supprimée.
 *
 * Renvoyer la position, et pas seulement `false`, est ce qui rend le contrôle
 * utile : on sait à partir d'où le registre n'est plus digne de foi.
 */
export function verifyLedger(db: Db, tontineId: string): LedgerVerification {
  const ecritures = db
    .select()
    .from(ledgerEntries)
    .where(eq(ledgerEntries.tontineId, tontineId))
    .orderBy(asc(ledgerEntries.position))
    .all()

  let prevHash: string | null = null

  for (const [i, e] of ecritures.entries()) {
    const attendue = i + 1

    if (e.position !== attendue) {
      return {
        valid: false,
        brokenAt: attendue,
        reason: `Écriture manquante : la position ${attendue} est absente.`,
        entriesChecked: i,
      }
    }

    if (e.prevHash !== prevHash) {
      return {
        valid: false,
        brokenAt: e.position,
        reason: `Le maillon de la position ${e.position} ne suit pas la précédente.`,
        entriesChecked: i,
      }
    }

    const recalcule = computeHash({
      prevHash: e.prevHash,
      type: e.type,
      actorId: e.actorId,
      payload: e.payload,
      serverTimestamp: e.serverTimestamp,
    })

    if (recalcule !== e.hash) {
      return {
        valid: false,
        brokenAt: e.position,
        reason: `L’écriture en position ${e.position} a été modifiée après son enregistrement.`,
        entriesChecked: i,
      }
    }

    prevHash = e.hash
  }

  return { valid: true, entriesChecked: ecritures.length }
}

/** Lecture paginée du registre. Accessible à tout membre actif. */
export function readLedger(
  db: Db,
  tontineId: string,
  options: { roundId?: string, type?: LedgerType, limit?: number, cursor?: number } = {},
) {
  const limite = Math.min(options.limit ?? 20, 100)
  const conditions = [eq(ledgerEntries.tontineId, tontineId)]

  if (options.roundId) conditions.push(eq(ledgerEntries.roundId, options.roundId))
  if (options.type) conditions.push(eq(ledgerEntries.type, options.type))

  const lignes = db
    .select()
    .from(ledgerEntries)
    .where(and(...conditions))
    .orderBy(desc(ledgerEntries.position))
    .limit(limite + 1)
    .all()

  const items = lignes.slice(0, limite)
  return {
    items,
    nextCursor: lignes.length > limite ? String(items.at(-1)?.position ?? '') : null,
  }
}
