import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SmsNonConfigureError, envoyerMessage, fournisseurConfigure, fournisseurHttp, texteCode, utiliserFournisseur,
} from '../../server/services/sms.ts'

/**
 * L'envoi des codes : le fournisseur se choisit par l'environnement, la
 * passerelle HTTP envoie ce qu'on attend, et rien ne part « dans les
 * journaux » en production.
 */

afterEach(() => {
  utiliserFournisseur(null)
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('choix du fournisseur', () => {
  it('journalise hors production quand rien n’est configuré', () => {
    vi.stubEnv('NODE_ENV', 'test')
    expect(fournisseurConfigure({}).nom).toBe('log')
  })

  it('refuse « log » en production : un code écrit dans un journal n’est pas parti', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => fournisseurConfigure({ NUXT_SMS_PROVIDER: 'log' })).toThrow(SmsNonConfigureError)
    expect(() => fournisseurConfigure({})).toThrow(SmsNonConfigureError)
  })

  it('exige l’adresse et le jeton de la passerelle', () => {
    expect(() => fournisseurConfigure({ NUXT_SMS_PROVIDER: 'http', NUXT_SMS_HTTP_URL: 'https://x' }))
      .toThrow(SmsNonConfigureError)
    expect(fournisseurConfigure({
      NUXT_SMS_PROVIDER: 'http', NUXT_SMS_HTTP_URL: 'https://x', NUXT_SMS_HTTP_TOKEN: 't',
    }).nom).toBe('http')
  })
})

describe('passerelle HTTP', () => {
  it('poste le message en JSON avec le jeton', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)

    await fournisseurHttp({ url: 'https://sms.example/send', token: 'secret', sender: 'eTontine' })
      .envoyer({ to: '+2250707000001', message: '123456 est votre code', channel: 'sms' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://sms.example/send')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer secret')
    expect(JSON.parse(init.body as string)).toEqual({
      to: '+2250707000001', message: '123456 est votre code', channel: 'sms', sender: 'eTontine',
    })
  })

  it('échoue quand la passerelle refuse, sans recopier sa réponse', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, text: async () => '123456' }))
    await expect(
      fournisseurHttp({ url: 'https://sms.example/send', token: 't' })
        .envoyer({ to: '+2250707000001', message: 'x', channel: 'sms' }),
    ).rejects.toThrow(/502/)
  })
})

describe('envoi', () => {
  it('passe par le fournisseur imposé', async () => {
    const envoyer = vi.fn().mockResolvedValue(undefined)
    utiliserFournisseur({ nom: 'test', envoyer })
    await envoyerMessage({ to: '+2250707000001', message: 'salut', channel: 'sms' })
    expect(envoyer).toHaveBeenCalledWith({ to: '+2250707000001', message: 'salut', channel: 'sms' })
  })

  it('formule un code lisible, et épelé pour l’appel vocal', () => {
    expect(texteCode('123456', 'sms')).toContain('123456')
    expect(texteCode('123456', 'sms')).toContain('5 minutes')
    expect(texteCode('123456', 'voice')).toContain('1, 2, 3, 4, 5, 6')
  })
})
