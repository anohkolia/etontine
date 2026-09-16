import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MIGRATIONS_DIR, migrationNames, rollbackAll } from '../../server/db/migrator.ts'
import type { Db } from '../../server/db/index.ts'
import { is } from 'drizzle-orm'
import { PgTable } from 'drizzle-orm/pg-core'
import * as schema from '../../server/db/schema.ts'

/**
 * Les migrations, jouées sur un Postgres neuf (PGlite, en mémoire) : le même
 * moteur que Supabase, la même table de suivi Drizzle, les mêmes contraintes.
 */

let pg: PGlite
let db: Db

/** Les tables applicatives du schéma `public`, hors journal de Drizzle. */
async function tables(): Promise<string[]> {
  const { rows } = await pg.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
  )
  return rows.map(r => r.table_name)
}

async function monter() {
  await migrate(db as never, { migrationsFolder: MIGRATIONS_DIR })
}

beforeEach(async () => {
  pg = await PGlite.create()
  db = drizzle(pg, { schema }) as unknown as Db
})

afterEach(async () => {
  await pg.close()
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

  it('un cycle montée → descente → montée rend le schéma identique', async () => {
    await monter()
    const apresMontee = await tables()

    // Le nombre attendu est dérivé du schéma, jamais figé dans le test : une
    // table ajoutée ne doit pas faire tomber ce contrôle pour une mauvaise
    // raison, elle doit faire tomber celui de la descente s'il l'oublie.
    // `is(v, PgTable)` et non un simple test d'objet : le module exporte aussi
    // des tableaux de constantes, qui compteraient pour des tables.
    const tablesDuSchema = Object.values(schema).filter(v => is(v, PgTable)).length
    expect(apresMontee.length).toBe(tablesDuSchema)

    await rollbackAll(db)
    expect(await tables(), 'la descente a laissé des tables derrière elle').toEqual([])

    // La remontée doit réellement reconstruire : si les lignes de suivi
    // n'avaient pas été retirées, Drizzle considérerait les migrations comme
    // appliquées et ne ferait rien — une base vide, sans la moindre erreur.
    await monter()
    expect(await tables(), 'la remontée n’a rien reconstruit').toEqual(apresMontee)
  })

  it('annule les migrations de la plus récente à la plus ancienne', async () => {
    await monter()
    const annulees = await rollbackAll(db)
    expect(annulees).toEqual([...migrationNames()].reverse())
  })

  it('la descente oublie-t-elle une table ? — comparaison nom par nom', async () => {
    await monter()
    const creees = await tables()
    const descente = readdirSync(join(MIGRATIONS_DIR, 'down'))
      .map(f => readFileSync(join(MIGRATIONS_DIR, 'down', f), 'utf8'))
      .join('\n')

    for (const table of creees) {
      expect(descente, `« ${table} » n’est jamais supprimée par la descente`).toContain(`"${table}"`)
    }
  })
})

describe('contraintes tenues par la base, pas par le code', () => {
  beforeEach(async () => {
    await monter()
    await pg.exec(`
      INSERT INTO users (id, phone) VALUES ('u1', '+2250707000001');
      INSERT INTO tontines (id, name, share_amount, frequency, start_date, created_by)
        VALUES ('t1', 'T', 25000, 'monthly', '2026-01-01', 'u1');
      INSERT INTO memberships (id, tontine_id, user_id) VALUES ('m1', 't1', 'u1');
      INSERT INTO memberships (id, tontine_id, managed_name) VALUES ('m2', 't1', 'Autre');
    `)
  })

  it('refuse deux parts à la même position de rotation', async () => {
    // Acceptation T04. Deux membres à la même position, c'est un tour sans
    // bénéficiaire clair — la base doit le rendre impossible, pas le code.
    await pg.exec(`INSERT INTO shares (id, tontine_id, membership_id, rotation_position) VALUES ('s1', 't1', 'm1', 1)`)

    await expect(
      pg.exec(`INSERT INTO shares (id, tontine_id, membership_id, rotation_position) VALUES ('s2', 't1', 'm2', 1)`),
    ).rejects.toThrow(/unique/i)
  })

  it('accepte deux parts au même membre, à des positions distinctes', async () => {
    // Le double part est un cas normal, pas une anomalie à bloquer.
    await pg.exec(`
      INSERT INTO shares (id, tontine_id, membership_id, rotation_position) VALUES ('s1', 't1', 'm1', 1);
      INSERT INTO shares (id, tontine_id, membership_id, rotation_position) VALUES ('s2', 't1', 'm1', 2);
    `)
    const { rows } = await pg.query<{ c: number | string }>(`SELECT COUNT(*) c FROM shares WHERE membership_id = 'm1'`)
    expect(Number(rows[0]!.c)).toBe(2)
  })

  it('refuse deux adhésions du même utilisateur à la même tontine', async () => {
    // Sinon le rattachement d'un membre géré dédouble son historique (T12).
    await expect(
      pg.exec(`INSERT INTO memberships (id, tontine_id, user_id) VALUES ('m3', 't1', 'u1')`),
    ).rejects.toThrow(/unique/i)
  })

  it('refuse deux tours au même index dans une tontine', async () => {
    await pg.exec(`
      INSERT INTO shares (id, tontine_id, membership_id, rotation_position) VALUES ('s1', 't1', 'm1', 1);
      INSERT INTO rounds (id, tontine_id, "index", due_date, beneficiary_share_id, expected_amount)
        VALUES ('r1', 't1', 1, '2026-01-01', 's1', 25000);
    `)
    await expect(
      pg.exec(`INSERT INTO rounds (id, tontine_id, "index", due_date, beneficiary_share_id, expected_amount)
        VALUES ('r2', 't1', 1, '2026-02-01', 's1', 25000)`),
    ).rejects.toThrow(/unique/i)
  })

  it('refuse deux écritures de registre à la même position de chaîne', async () => {
    // Le chaînage n'a de valeur que si les positions sont uniques par tontine.
    await pg.exec(`INSERT INTO ledger_entries (id, tontine_id, type, actor_id, payload, hash, position)
      VALUES ('l1', 't1', 'member_joined', 'u1', '{}', 'h1', 1)`)

    await expect(
      pg.exec(`INSERT INTO ledger_entries (id, tontine_id, type, actor_id, payload, hash, position)
        VALUES ('l2', 't1', 'member_joined', 'u1', '{}', 'h2', 1)`),
    ).rejects.toThrow(/unique/i)
  })

  it('stocke les montants en entiers, jamais en flottants', async () => {
    // Règle 6 : la colonne est un `integer` Postgres. Un montant ne peut pas y
    // garder de décimale, quoi que le code envoie.
    const { rows } = await pg.query<{ column_name: string, data_type: string }>(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'contributions'`,
    )
    for (const nom of ['expected_amount', 'confirmed_amount']) {
      expect(rows.find(c => c.column_name === nom)?.data_type).toBe('integer')
    }
  })
})
