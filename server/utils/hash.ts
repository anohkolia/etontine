import { createHash } from 'node:crypto'

/**
 * Sérialisation JSON canonique : clés triées récursivement, aucun espace.
 *
 * Indispensable dès qu'on hache une donnée structurée. `{a:1,b:2}` et
 * `{b:2,a:1}` sont le même objet mais deux chaînes différentes : sans
 * canonicalisation, le registre chaîné (T06) casserait au premier réordonnancement
 * de clés par une bibliothèque, et l'idempotence considérerait comme distincts
 * deux corps de requête identiques.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalise(value))
}

function canonicalise(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(canonicalise)
  if (value instanceof Date) return value.toISOString()

  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .sort()
      .map(k => [k, canonicalise((value as Record<string, unknown>)[k])]),
  )
}

export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

/** Empreinte d'un corps de requête, pour l'idempotence. */
export function hashPayload(value: unknown): string {
  return sha256(canonicalJson(value))
}
