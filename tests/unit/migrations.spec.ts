import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MIGRATIONS_DIR, migrationNames, rollbackAll } from '../../server/db/migrator.ts'
import { is } from 'drizzle-orm'
import { SQLiteTable } from 'drizzle-orm/sqlite-core'
import * as schema from '../../server/db/schema.ts'

let dossier: string
let fichier: string
let sqlite: Database.Database

/** Les tables applicatives, hors table de suivi de Drizzle. */
function tables(db: Database.Database): string[] {
  return (db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '__drizzle_migrations' ORDER BY name`)
    .all() as Array<{ name: string }>)
    .map(r => r.name)
}

function monter() {
  migrate(drizzle(sqlite), { migrationsFolder: MIGRATIONS_DIR })
}

beforeEach(() => {
  dossier = mkdtempSync(join(tmpdir(), 'tontine-migrations-'))
  fichier = join(dossier, 'test.sqlite')
  sqlite = new Database(fichier)
})

afterEach(() => {
  sqlite.close()
  rmSync(dossier, { recursive: true, force: true })
})

describe('migrations — réversibilité', () => {
  it('chaque migration possède sa descente écrite à la main', () => {
    // `drizzle-kit` ne génère que la montée. Une migration ajoutée sans son
    // fichier de descente rendrait le schéma irréversible en silence.
    const noms = migrationNames()
    expect(noms.length).toBeGreaterThan(0)

    for (const nom of noms) {
      const descente = join(MIGRATIONS_DIR, 'down', `${nom}.down.sql`)
      expect(existsSync(descente), `descente manquante pour ${nom}`).toBe(true)
    }
  })

  it('un cycle montée → descente → montée rend le schéma identique', () => {
    monter()
    const apresMontee = tables(sqlite)

    // Le nombre attendu est dérivé du schéma, jamais figé dans le test : une
    // table ajoutée ne doit pas faire tomber ce contrôle pour une mauvaise
    // raison, elle doit faire tomber celui de la descente s'il l'oublie.
    // `is(v, SQLiteTable)` et non un simple test d'objet : le module exporte
    // aussi des tableaux de constantes, qui compteraient pour des tables.
    const tablesDuSchema = Object.values(schema).filter(v => is(v, SQLiteTable)).length
    expect(apresMontee.length).toBe(tablesDuSchema)

    rollbackAll(sqlite)
    expect(tables(sqlite), 'la descente a laissé des tables derrière elle').toEqual([])

    // La remontée doit réellement reconstruire : si les lignes de suivi
    // n'avaient pas été retirées, Drizzle considérerait les migrations comme
    // appliquées et ne ferait rien — une base vide, sans la moindre erreur.
    monter()
    expect(tables(sqlite), 'la remontée n’a rien reconstruit').toEqual(apresMontee)
  })

  it('annule les migrations de la plus récente à la plus ancienne', () => {
    monter()
    const annulees = rollbackAll(sqlite)
    expect(annulees).toEqual([...migrationNames()].reverse())
  })

  it('la descente oublie-t-elle une table ? — comparaison nom par nom', () => {
    monter()
    const creees = tables(sqlite)
    const descente = readdirSync(join(MIGRATIONS_DIR, 'down'))
      .map(f => readFileSync(join(MIGRATIONS_DIR, 'down', f), 'utf8'))
      .join('\n')

    for (const table of creees) {
      expect(descente, `\`${table}\` n’est jamais supprimée par la descente`).toContain(`\`${table}\``)
    }
  })
})

describe('contraintes tenues par la base, pas par le code', () => {
  beforeEach(() => {
    monter()
    sqlite.exec(`
      INSERT INTO users (id, phone) VALUES ('u1', '+2250707000001');
      INSERT INTO tontines (id, name, share_amount, frequency, start_date, created_by)
        VALUES ('t1', 'T', 25000, 'monthly', '2026-01-01', 'u1');
      INSERT INTO memberships (id, tontine_id, user_id) VALUES ('m1', 't1', 'u1');
      INSERT INTO memberships (id, tontine_id, managed_name) VALUES ('m2', 't1', 'Autre');
    `)
  })

  it('refuse deux parts à la même position de rotation', () => {
    // Acceptation T04. Deux membres à la même position, c'est un tour sans
    // bénéficiaire clair — la base doit le rendre impossible, pas le code.
    sqlite.exec(`INSERT INTO shares (id, tontine_id, membership_id, rotation_position) VALUES ('s1', 't1', 'm1', 1)`)

    expect(() =>
      sqlite.exec(`INSERT INTO shares (id, tontine_id, membership_id, rotation_position) VALUES ('s2', 't1', 'm2', 1)`),
    ).toThrow(/UNIQUE/i)
  })

  it('accepte deux parts au même membre, à des positions distinctes', () => {
    // Le double part est un cas normal, pas une anomalie à bloquer.
    sqlite.exec(`
      INSERT INTO shares (id, tontine_id, membership_id, rotation_position) VALUES ('s1', 't1', 'm1', 1);
      INSERT INTO shares (id, tontine_id, membership_id, rotation_position) VALUES ('s2', 't1', 'm1', 2);
    `)
    const n = sqlite.prepare(`SELECT COUNT(*) c FROM shares WHERE membership_id = 'm1'`).get() as { c: number }
    expect(n.c).toBe(2)
  })

  it('refuse deux adhésions du même utilisateur à la même tontine', () => {
    // Sinon le rattachement d'un membre géré dédouble son historique (T12).
    expect(() =>
      sqlite.exec(`INSERT INTO memberships (id, tontine_id, user_id) VALUES ('m3', 't1', 'u1')`),
    ).toThrow(/UNIQUE/i)
  })

  it('refuse deux tours au même index dans une tontine', () => {
    sqlite.exec(`
      INSERT INTO shares (id, tontine_id, membership_id, rotation_position) VALUES ('s1', 't1', 'm1', 1);
      INSERT INTO rounds (id, tontine_id, "index", due_date, beneficiary_share_id, expected_amount)
        VALUES ('r1', 't1', 1, '2026-01-01', 's1', 25000);
    `)
    expect(() =>
      sqlite.exec(`INSERT INTO rounds (id, tontine_id, "index", due_date, beneficiary_share_id, expected_amount)
        VALUES ('r2', 't1', 1, '2026-02-01', 's1', 25000)`),
    ).toThrow(/UNIQUE/i)
  })

  it('refuse deux écritures de registre à la même position de chaîne', () => {
    // Le chaînage n'a de valeur que si les positions sont uniques par tontine.
    sqlite.exec(`INSERT INTO ledger_entries (id, tontine_id, type, actor_id, payload, hash, position)
      VALUES ('l1', 't1', 'member_joined', 'u1', '{}', 'h1', 1)`)

    expect(() =>
      sqlite.exec(`INSERT INTO ledger_entries (id, tontine_id, type, actor_id, payload, hash, position)
        VALUES ('l2', 't1', 'member_joined', 'u1', '{}', 'h2', 1)`),
    ).toThrow(/UNIQUE/i)
  })

  it('stocke les montants en entiers, jamais en flottants', () => {
    // Règle 6. SQLite est typé souplement : la colonne doit être déclarée
    // `integer` pour que l'affinité arrondisse au lieu de stocker 25000.5.
    const colonnes = sqlite.prepare(`PRAGMA table_info(contributions)`).all() as Array<{ name: string, type: string }>
    for (const nom of ['expected_amount', 'confirmed_amount']) {
      expect(colonnes.find(c => c.name === nom)?.type.toLowerCase()).toBe('integer')
    }
  })
})
