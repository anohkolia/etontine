import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TLSSocket } from 'node:tls'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { estDistante, estPoolerTransaction, optionsTls, refuserBaseDistante } from '../../server/db/index.ts'

/**
 * La connexion à la base : reconnaître où l'on est (machine locale, pooler de
 * Supabase en mode transaction) et, hors de la machine, ne parler qu'à une
 * base dont on a vérifié l'identité.
 */

const LOCALE = 'postgres://postgres:postgres@127.0.0.1:5433/postgres'
const POOLER_TRANSACTION = 'postgresql://postgres.ref:pw@aws-0-eu-west-3.pooler.supabase.com:6543/postgres'
const POOLER_SESSION = 'postgresql://postgres.ref:pw@aws-0-eu-west-3.pooler.supabase.com:5432/postgres'
const DIRECTE = 'postgresql://postgres:pw@db.ref.supabase.co:5432/postgres'

describe('où est la base', () => {
  it('reconnaît la machine locale sous ses trois noms', () => {
    expect(estDistante(LOCALE)).toBe(false)
    expect(estDistante('postgres://u:p@localhost/postgres')).toBe(false)
    expect(estDistante('postgres://u:p@[::1]:5433/postgres')).toBe(false)
    expect(estDistante(POOLER_TRANSACTION)).toBe(true)
    expect(estDistante(DIRECTE)).toBe(true)
  })

  it('ne coupe les requêtes préparées que derrière le pooler en mode transaction', () => {
    expect(estPoolerTransaction(POOLER_TRANSACTION)).toBe(true)
    expect(estPoolerTransaction('postgres://u:p@h:5432/db?pgbouncer=true')).toBe(true)
    expect(estPoolerTransaction(POOLER_SESSION)).toBe(false)
    expect(estPoolerTransaction(DIRECTE)).toBe(false)
    expect(estPoolerTransaction(LOCALE)).toBe(false)
  })
})

describe('options TLS', () => {
  it('ne demande pas de TLS au serveur PGlite local', () => {
    expect(optionsTls(LOCALE, {})).toBeUndefined()
    expect(optionsTls(LOCALE, { DATABASE_CA_CERT: 'peu importe' })).toBeUndefined()
  })

  it('vérifie toujours une base distante — jamais « require », qui ne vérifie rien', () => {
    expect(optionsTls(POOLER_TRANSACTION, {})).toBe('verify-full')
    expect(optionsTls(POOLER_SESSION, {})).toBe('verify-full')
    expect(optionsTls(DIRECTE, { DATABASE_CA_CERT: '   ' })).toBe('verify-full')
  })

  it('accepte l’autorité privée de DATABASE_CA_CERT, retours à la ligne « \\n » compris', () => {
    const pem = '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----'
    expect(optionsTls(DIRECTE, { DATABASE_CA_CERT: pem })).toEqual({ ca: pem })
    expect(optionsTls(DIRECTE, { DATABASE_CA_CERT: ' -----BEGIN CERTIFICATE-----\\nabc\\n-----END CERTIFICATE----- ' }))
      .toEqual({ ca: pem })
  })
})

describe('gestes destructeurs — db:rollback, db:seed, donc db:reset', () => {
  it('laisse faire sur la machine locale', () => {
    expect(() => refuserBaseDistante(LOCALE, 'db:seed', {})).not.toThrow()
  })

  it('refuse une base hors de la machine, en nommant l’hôte mais jamais le mot de passe', () => {
    const url = 'postgresql://postgres.ref:tres-secret@aws-0-eu-west-3.pooler.supabase.com:5432/postgres'
    expect(() => refuserBaseDistante(url, 'db:rollback', {})).toThrow(/db:rollback/)
    let message = ''
    try {
      refuserBaseDistante(url, 'db:rollback', {})
    }
    catch (e) {
      message = (e as Error).message
    }
    expect(message).toContain('aws-0-eu-west-3.pooler.supabase.com:5432')
    expect(message).toContain('DATABASE_ALLOW_RESET=1')
    expect(message).not.toContain('tres-secret')
  })

  it('cède à DATABASE_ALLOW_RESET=1, et à rien d’autre', () => {
    expect(() => refuserBaseDistante(DIRECTE, 'db:seed', { DATABASE_ALLOW_RESET: '1' })).not.toThrow()
    expect(() => refuserBaseDistante(DIRECTE, 'db:seed', { DATABASE_ALLOW_RESET: 'true' })).toThrow()
    expect(() => refuserBaseDistante(DIRECTE, 'db:seed', { DATABASE_ALLOW_RESET: '' })).toThrow()
  })
})

/**
 * Ce que le pilote fait de ces options — c'est de lui que dépend toute la
 * garantie. Un faux serveur Postgres, derrière un certificat auto-signé, joue
 * le début du protocole : « S » à la demande de TLS, la poignée de main, puis
 * une erreur Postgres au premier message du client. En `verify-full`, le
 * client doit refuser ce certificat inconnu avant d'avoir rien envoyé ; avec
 * cette autorité dans `ca`, il doit aller jusqu'à l'erreur du serveur.
 *
 * Le faux serveur se joint par un **nom** (`localhost`), comme Supabase : Node
 * vérifie l'identité du certificat contre le nom d'hôte, et une adresse IP
 * brute n'en fournit pas.
 */
function opensslDisponible(): boolean {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' })
    return true
  }
  catch {
    return false
  }
}

/** Un message ErrorResponse du protocole Postgres : 'E', longueur, champs, zéro final. */
function erreurPostgres(message: string): Buffer {
  const champs = Buffer.concat([
    Buffer.from('SFATAL\0'), Buffer.from('VFATAL\0'), Buffer.from('C28000\0'), Buffer.from(`M${message}\0`), Buffer.from('\0'),
  ])
  const entete = Buffer.alloc(5)
  entete.write('E', 0)
  entete.writeInt32BE(champs.length + 4, 1)
  return Buffer.concat([entete, champs])
}

describe.skipIf(!opensslDisponible())('vérification du certificat par le pilote', () => {
  let dossier: string
  let cle: string
  let certificat: string

  beforeAll(() => {
    dossier = mkdtempSync(join(tmpdir(), 'etontine-tls-'))
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-subj', '/CN=faux-supabase', '-addext', 'subjectAltName=DNS:localhost',
      '-keyout', join(dossier, 'cle.pem'), '-out', join(dossier, 'certificat.pem'),
    ], { stdio: 'ignore' })
    cle = readFileSync(join(dossier, 'cle.pem'), 'utf8')
    certificat = readFileSync(join(dossier, 'certificat.pem'), 'utf8')
  })

  afterAll(() => {
    rmSync(dossier, { recursive: true, force: true })
  })

  /** Accepte la négociation TLS de Postgres, compte les poignées de main abouties, puis congédie le client. */
  async function fauxServeur() {
    let poigneesDeMain = 0
    const serveur = net.createServer((socket) => {
      socket.on('error', () => {})
      socket.once('data', () => {
        socket.write('S')
        const tls = new TLSSocket(socket, { isServer: true, key: cle, cert: certificat })
        tls.on('secure', () => {
          poigneesDeMain++
        })
        tls.once('data', () => tls.end(erreurPostgres('faux serveur : fin de la simulation')))
        tls.on('error', () => {})
      })
    })
    await new Promise<void>(resolve => serveur.listen(0, '127.0.0.1', resolve))
    const { port } = serveur.address() as net.AddressInfo
    return {
      url: `postgres://u:p@localhost:${port}/db`,
      poignees: () => poigneesDeMain,
      fermer: () => new Promise<void>(resolve => serveur.close(() => resolve())),
    }
  }

  async function tenter(url: string, ssl: 'require' | ReturnType<typeof optionsTls>): Promise<Error & { code?: string }> {
    const sql = postgres(url, { ssl, max: 1, connect_timeout: 5, fetch_types: false })
    try {
      await sql`select 1`
      throw new Error('la connexion aurait dû échouer : le faux serveur congédie tout client')
    }
    catch (e) {
      return e as Error & { code?: string }
    }
    finally {
      await sql.end({ timeout: 0 })
    }
  }

  it('refuse un certificat que personne ne signe, avant d’avoir rien envoyé', async () => {
    const serveur = await fauxServeur()
    try {
      const erreur = await tenter(serveur.url, optionsTls(DIRECTE, {}))
      expect(erreur.code).toMatch(/SELF_SIGNED|UNABLE_TO_VERIFY/)
      expect(serveur.poignees()).toBe(0)
    }
    finally {
      await serveur.fermer()
    }
  })

  it('accepte ce même certificat quand DATABASE_CA_CERT le désigne', async () => {
    const serveur = await fauxServeur()
    try {
      const erreur = await tenter(serveur.url, optionsTls(DIRECTE, { DATABASE_CA_CERT: certificat }))
      expect(serveur.poignees()).toBe(1)
      // L'erreur vient du faux serveur, donc d'au-delà de la poignée de main.
      expect(erreur.code).toBe('28000')
    }
    finally {
      await serveur.fermer()
    }
  })

  it('« require » l’aurait accepté sans autorité : c’est pour cela qu’on ne s’en sert pas', async () => {
    const serveur = await fauxServeur()
    try {
      const erreur = await tenter(serveur.url, 'require')
      expect(serveur.poignees()).toBe(1)
      expect(erreur.code).toBe('28000')
    }
    finally {
      await serveur.fermer()
    }
  })
})
