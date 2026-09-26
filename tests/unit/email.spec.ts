import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  EmailNonConfigureError, adresseExpediteur, envoyerEmail, fournisseurBrevo, fournisseurEmailConfigure,
  fournisseurResend, messages, utiliserFournisseurEmail,
} from '../../server/services/email.ts'

/**
 * L'envoi des liens : le fournisseur se choisit par l'environnement, Resend
 * reçoit ce qu'on attend, et rien ne part « dans les journaux » en production.
 */

afterEach(() => {
  utiliserFournisseurEmail(null)
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('choix du fournisseur', () => {
  it('journalise hors production quand rien n’est configuré', () => {
    vi.stubEnv('NODE_ENV', 'test')
    expect(fournisseurEmailConfigure({}).nom).toBe('log')
  })

  it('refuse « log » en production : un lien écrit dans un journal n’est pas parti', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => fournisseurEmailConfigure({ NUXT_EMAIL_PROVIDER: 'log' })).toThrow(EmailNonConfigureError)
    expect(() => fournisseurEmailConfigure({})).toThrow(EmailNonConfigureError)
  })

  it('exige la clé et l’expéditeur de Brevo', () => {
    expect(() => fournisseurEmailConfigure({ NUXT_EMAIL_PROVIDER: 'brevo', NUXT_EMAIL_BREVO_API_KEY: 'k' }))
      .toThrow(EmailNonConfigureError)
    expect(() => fournisseurEmailConfigure({ NUXT_EMAIL_PROVIDER: 'brevo', NUXT_EMAIL_FROM: 'a@b.ci' }))
      .toThrow(EmailNonConfigureError)
    expect(fournisseurEmailConfigure({
      NUXT_EMAIL_PROVIDER: 'brevo',
      NUXT_EMAIL_BREVO_API_KEY: 'k',
      NUXT_EMAIL_FROM: 'eTontine <no-reply@tontine.ci>',
    }).nom).toBe('brevo')
  })

  it('exige la clé et l’expéditeur de Resend', () => {
    expect(() => fournisseurEmailConfigure({ NUXT_EMAIL_PROVIDER: 'resend', NUXT_EMAIL_RESEND_API_KEY: 'k' }))
      .toThrow(EmailNonConfigureError)
    expect(fournisseurEmailConfigure({
      NUXT_EMAIL_PROVIDER: 'resend', NUXT_EMAIL_RESEND_API_KEY: 'k', NUXT_EMAIL_FROM: 'eTontine <no-reply@tontine.ci>',
    }).nom).toBe('resend')
  })
})

describe('expéditeur', () => {
  it('découpe « Nom <adresse> », tolère les espaces et les guillemets', () => {
    expect(adresseExpediteur('eTontine <no-reply@tontine.ci>'))
      .toEqual({ name: 'eTontine', email: 'no-reply@tontine.ci' })
    expect(adresseExpediteur('  "eTontine"  < no-reply@tontine.ci >  '))
      .toEqual({ name: 'eTontine', email: 'no-reply@tontine.ci' })
  })

  it('accepte une adresse nue, sans nom', () => {
    expect(adresseExpediteur(' no-reply@tontine.ci ')).toEqual({ email: 'no-reply@tontine.ci' })
    expect(adresseExpediteur('<no-reply@tontine.ci>')).toEqual({ email: 'no-reply@tontine.ci' })
  })

  it('refuse ce qui n’est pas une adresse', () => {
    // Mieux vaut échouer au premier envoi que laisser les liens partir nulle part.
    expect(() => adresseExpediteur('eTontine')).toThrow(/adresse/)
    expect(() => adresseExpediteur('eTontine <vide>')).toThrow(/adresse/)
  })
})

describe('Brevo', () => {
  it('poste le message avec la clé dans son en-tête, et l’expéditeur découpé', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201 })
    vi.stubGlobal('fetch', fetchMock)

    await fournisseurBrevo({ apiKey: 'secret', from: 'eTontine <no-reply@tontine.ci>' })
      .envoyer({ to: 'aya@exemple.ci', subject: 'Bienvenue', text: 'Ouvre ce lien' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.brevo.com/v3/smtp/email')

    const entetes = init.headers as Record<string, string>
    expect(entetes['api-key']).toBe('secret')
    // Brevo ne lit pas `Authorization` : une clé posée là partirait dans le vide.
    expect(entetes.authorization).toBeUndefined()

    expect(JSON.parse(init.body as string)).toEqual({
      sender: { name: 'eTontine', email: 'no-reply@tontine.ci' },
      to: [{ email: 'aya@exemple.ci' }],
      subject: 'Bienvenue',
      textContent: 'Ouvre ce lien',
    })
  })

  it('échoue quand Brevo refuse, sans recopier sa réponse', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'jeton-secret' }))

    const erreur = await fournisseurBrevo({ apiKey: 'k', from: 'no-reply@tontine.ci' })
      .envoyer({ to: 'aya@exemple.ci', subject: 'x', text: 'jeton-secret' })
      .then(() => null, (e: unknown) => e as Error)

    expect(erreur).toBeInstanceOf(Error)
    expect(erreur!.message).toContain('401')
    // Le corps de la réponse peut reprendre le message, donc le lien : il n'a
    // rien à faire dans une erreur, qui finira dans un journal.
    expect(erreur!.message).not.toContain('jeton-secret')
  })
})

describe('Resend', () => {
  it('poste le message en JSON avec la clé', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)

    await fournisseurResend({ apiKey: 'secret', from: 'eTontine <no-reply@tontine.ci>' })
      .envoyer({ to: 'aya@exemple.ci', subject: 'Bienvenue', text: 'Ouvre ce lien' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.resend.com/emails')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer secret')
    expect(JSON.parse(init.body as string)).toEqual({
      from: 'eTontine <no-reply@tontine.ci>', to: ['aya@exemple.ci'], subject: 'Bienvenue', text: 'Ouvre ce lien',
    })
  })

  it('échoue quand Resend refuse, sans recopier sa réponse', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 422, text: async () => 'jeton-secret' }))
    await expect(
      fournisseurResend({ apiKey: 'k', from: 'x@y.z' })
        .envoyer({ to: 'aya@exemple.ci', subject: 'x', text: 'jeton-secret' }),
    ).rejects.toThrow(/422/)
  })
})

describe('envoi et messages', () => {
  it('passe par le fournisseur imposé', async () => {
    const envoyer = vi.fn().mockResolvedValue(undefined)
    utiliserFournisseurEmail({ nom: 'test', envoyer })
    await envoyerEmail({ to: 'aya@exemple.ci', subject: 'Salut', text: 'x' })
    expect(envoyer).toHaveBeenCalledWith({ to: 'aya@exemple.ci', subject: 'Salut', text: 'x' })
  })

  it('met le lien seul sur sa ligne, avec le jeton', () => {
    vi.stubEnv('NUXT_PUBLIC_SITE_URL', 'https://tontine.ci/')
    const { text } = messages.confirmation('JETON')
    expect(text).toMatch(/^https:\/\/tontine\.ci\/confirmer\?token=JETON$/m)
    expect(messages.reinitialisation('J').text).toMatch(/^https:\/\/tontine\.ci\/reinitialiser\?token=J$/m)
  })

  it('ne parle jamais d’argent : une boîte mail se partage comme un téléphone', () => {
    const tous = [
      messages.confirmation('t'), messages.changementEmail('t'), messages.reinitialisation('t'),
      messages.compteVerrouille('t'), messages.dejaInscrit(), messages.numeroChange('0001'), messages.emailChange('a@b.c'),
    ]
    for (const m of tous) expect(`${m.subject} ${m.text}`).not.toMatch(/FCFA|XOF|\d{2,3}[ \u00A0\u202F]\d{3}/)
  })
})
