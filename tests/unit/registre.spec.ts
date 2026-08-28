import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appendLedger, verifyLedger } from '../../server/services/ledger.ts'
import { ledgerEntries, tontines } from '../../server/db/schema.ts'
import { createTestDb, createTestUser } from '../helpers/db.ts'
import type { TestDb } from '../helpers/db.ts'

let db: TestDb
let sqlite: import('better-sqlite3').Database
let cleanup: () => void

const T = 'a0000000-0000-4000-8000-000000000001'
const U = 'a0000000-0000-4000-8000-000000000002'

beforeEach(async () => {
  const ctx = createTestDb()
  db = ctx.db
  sqlite = ctx.sqlite
  cleanup = ctx.cleanup

  await createTestUser(db, U, '+2250707000001')
  await db.insert(tontines).values({
    id: T, name: 'Tontine des tantines', shareAmount: 25_000,
    frequency: 'monthly', startDate: '2026-01-01', createdBy: U,
  })
})

afterEach(() => cleanup())

function troisEcritures() {
  appendLedger(db, { tontineId: T, type: 'member_joined', actorId: U, payload: { membre: 'Aya' } })
  appendLedger(db, { tontineId: T, type: 'contribution_declared', actorId: U, payload: { montant: 25_000 } })
  appendLedger(db, { tontineId: T, type: 'contribution_confirmed', actorId: U, payload: { montant: 25_000 } })
}

describe('registre — chaînage', () => {
  it('chaîne les écritures et les numérote à partir de 1', () => {
    troisEcritures()
    const lignes = sqlite.prepare(`SELECT position, prev_hash, hash FROM ledger_entries ORDER BY position`).all() as Array<{ position: number, prev_hash: string | null, hash: string }>

    expect(lignes.map(l => l.position)).toEqual([1, 2, 3])
    expect(lignes[0]!.prev_hash).toBeNull()
    expect(lignes[1]!.prev_hash).toBe(lignes[0]!.hash)
    expect(lignes[2]!.prev_hash).toBe(lignes[1]!.hash)
  })

  it('valide une chaîne intacte', () => {
    troisEcritures()
    expect(verifyLedger(db, T)).toMatchObject({ valid: true, entriesChecked: 3 })
  })

  it('horodate depuis le serveur, jamais depuis le payload client', () => {
    // Un client qui glisse une date dans son payload ne doit pas pouvoir
    // antidater sa cotisation : le payload est haché, mais l'horodatage du
    // chaînage vient de l'horloge serveur.
    const avant = Date.now()
    const e = appendLedger(db, {
      tontineId: T,
      type: 'contribution_declared',
      actorId: U,
      payload: { declaredAt: '1999-01-01T00:00:00.000Z' },
    })
    const apres = Date.now()

    expect(e.serverTimestamp.getTime()).toBeGreaterThanOrEqual(Math.floor(avant / 1000) * 1000)
    expect(e.serverTimestamp.getTime()).toBeLessThanOrEqual(apres)
  })

  it('isole les chaînes par tontine', async () => {
    const T2 = 'a0000000-0000-4000-8000-000000000003'
    await db.insert(tontines).values({
      id: T2, name: 'Autre', shareAmount: 10_000,
      frequency: 'weekly', startDate: '2026-01-01', createdBy: U,
    })
    troisEcritures()
    const e = appendLedger(db, { tontineId: T2, type: 'member_joined', actorId: U, payload: {} })

    // Une nouvelle tontine repart de 1, sans hériter du hachage d'une autre.
    expect(e.position).toBe(1)
    expect(e.prevHash).toBeNull()
    expect(verifyLedger(db, T2).valid).toBe(true)
  })
})

describe('registre — détection d’altération (acceptation T06)', () => {
  it('altérer une écriture fait échouer la vérification, en indiquant la position', () => {
    troisEcritures()

    // On modifie directement en base, comme le ferait quelqu'un ayant accès au
    // serveur : c'est précisément ce que le chaînage doit rendre visible.
    sqlite.prepare(`UPDATE ledger_entries SET payload = ? WHERE position = 2`)
      .run(JSON.stringify({ montant: 250_000 }))

    const resultat = verifyLedger(db, T)

    expect(resultat.valid).toBe(false)
    expect(resultat.brokenAt).toBe(2)
    expect(resultat.reason).toContain('modifiée')
  })

  it('supprimer une écriture est détecté comme un trou dans la chaîne', () => {
    troisEcritures()
    sqlite.prepare(`DELETE FROM ledger_entries WHERE position = 2`).run()

    const resultat = verifyLedger(db, T)
    expect(resultat.valid).toBe(false)
    expect(resultat.brokenAt).toBe(2)
    expect(resultat.reason).toContain('manquante')
  })

  it('réécrire l’acteur d’une écriture est détecté', () => {
    troisEcritures()
    sqlite.prepare(`UPDATE ledger_entries SET actor_id = ? WHERE position = 3`).run(U)
    // Même acteur : la chaîne reste valide, rien n'a changé.
    expect(verifyLedger(db, T).valid).toBe(true)

    sqlite.prepare(`UPDATE ledger_entries SET type = 'contribution_rejected' WHERE position = 3`).run()
    const resultat = verifyLedger(db, T)
    expect(resultat.valid).toBe(false)
    expect(resultat.brokenAt).toBe(3)
  })

  it('décrocher un maillon est détecté avant même le recalcul', () => {
    troisEcritures()
    sqlite.prepare(`UPDATE ledger_entries SET prev_hash = 'faux' WHERE position = 3`).run()

    const resultat = verifyLedger(db, T)
    expect(resultat.valid).toBe(false)
    expect(resultat.brokenAt).toBe(3)
    expect(resultat.reason).toContain('ne suit pas')
  })

  it('signale la première rupture, pas la dernière', () => {
    troisEcritures()
    sqlite.prepare(`UPDATE ledger_entries SET payload = '{"x":1}' WHERE position = 2`).run()
    sqlite.prepare(`UPDATE ledger_entries SET payload = '{"x":2}' WHERE position = 3`).run()

    // Savoir à partir d'où le registre n'est plus digne de foi, c'est la
    // position la plus ancienne qui compte.
    expect(verifyLedger(db, T).brokenAt).toBe(2)
  })

  it('une chaîne vide est valide', () => {
    expect(verifyLedger(db, T)).toMatchObject({ valid: true, entriesChecked: 0 })
  })
})

describe('registre — append-only (acceptation T06)', () => {
  const RACINE = fileURLToPath(new URL('../../server/api', import.meta.url))

  function fichiers(dir: string): string[] {
    return readdirSync(dir).flatMap((f) => {
      const chemin = join(dir, f)
      return statSync(chemin).isDirectory() ? fichiers(chemin) : [chemin]
    })
  }

  it('n’expose aucune route de modification du registre', () => {
    // Règle 3. La règle porte sur la **ressource registre**, pas sur le mot
    // « ledger » dans un chemin : `ledger/:id/dispute` crée une contestation,
    // qui est une autre ressource, et c'est précisément la soupape prévue par
    // le modèle. Ce qui est interdit, c'est de modifier ou supprimer une
    // écriture, et d'en créer une autrement que par le service.
    const routes = fichiers(RACINE).map(f => f.slice(RACINE.length))

    const modifications = routes.filter(r =>
      r.includes('/ledger') && /\.(put|patch|delete)\.ts$/.test(r),
    )
    expect(modifications, `routes de modification interdites : ${modifications.join(', ')}`).toEqual([])

    // Et aucune route ne crée d'écriture directement.
    const creations = routes.filter(r => /\/ledger(\/index)?\.post\.ts$/.test(r))
    expect(creations, `création directe interdite : ${creations.join(', ')}`).toEqual([])
  })

  it('n’écrit au registre que par appendLedger', () => {
    // Le garde-fou qui compte vraiment : peu importe le nom du fichier, seule
    // `services/ledger.ts` a le droit d'écrire dans la table. Un `db.insert`
    // ailleurs contournerait le chaînage de hachage — et le registre ne
    // vaudrait plus rien, sans que rien n'échoue.
    const SERVICES = fileURLToPath(new URL('../../server', import.meta.url))
    const autorise = join(SERVICES, 'services', 'ledger.ts')

    const fautifs: string[] = []
    for (const chemin of fichiers(SERVICES)) {
      if (chemin === autorise || !chemin.endsWith('.ts')) continue

      const source = readFileSync(chemin, 'utf8')
      if (/\.(insert|update|delete)\(\s*ledgerEntries/.test(source)) {
        fautifs.push(chemin.slice(SERVICES.length))
      }
    }

    expect(fautifs, `écriture directe au registre : ${fautifs.join(', ')}`).toEqual([])
  })

  it('le service ne propose ni mise à jour ni suppression', async () => {
    const service = await import('../../server/services/ledger.ts')
    expect(Object.keys(service).sort()).toEqual(
      ['appendLedger', 'computeHash', 'readLedger', 'verifyLedger'],
    )
  })

  it('une correction s’écrit comme une annulation, en gardant la trace', () => {
    const originale = appendLedger(db, {
      tontineId: T, type: 'contribution_confirmed', actorId: U, payload: { montant: 25_000 },
    })

    const annulation = appendLedger(db, {
      tontineId: T,
      type: 'reversal',
      actorId: U,
      payload: { motif: 'Confirmation par erreur' },
      reversesId: originale.id,
    })

    expect(annulation.reversesId).toBe(originale.id)
    // L'originale est toujours là : l'erreur reste visible de tous.
    const restantes = db.select().from(ledgerEntries).where(eq(ledgerEntries.tontineId, T)).all()
    expect(restantes).toHaveLength(2)
    expect(verifyLedger(db, T).valid).toBe(true)
  })
})
