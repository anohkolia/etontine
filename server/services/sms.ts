import { isDevOrTest } from '../utils/env.ts'

/**
 * Envoi de messages — SMS et appel vocal.
 *
 * Le point d'entrée unique pour tout ce qui part vers un téléphone : le code
 * de connexion, le code de vérification d'un numéro de collecte, demain le SMS
 * d'invitation d'un membre géré. Aucun opérateur n'était branché : en
 * production, le code était écrit dans les journaux du serveur et personne ne
 * pouvait se connecter.
 *
 * Le fournisseur se choisit par `NUXT_SMS_PROVIDER` :
 *
 * - `log` — le message est écrit dans les journaux. C'est le seul mode admis
 *   hors production, et il est **refusé** en production : un code qui ne
 *   part pas doit faire échouer la demande, pas la laisser croire envoyée.
 * - `http` — une passerelle générique : `POST` JSON `{ to, message, channel,
 *   sender }` vers `NUXT_SMS_HTTP_URL`, avec `Authorization: Bearer
 *   NUXT_SMS_HTTP_TOKEN`. C'est la forme que prend un relais maison ou la
 *   plupart des agrégateurs ; brancher un fournisseur précis revient à écrire
 *   une fonction de plus ici, et rien d'autre.
 */
export type CanalMessage = 'sms' | 'voice'

export interface Message {
  /** Numéro E.164. */
  to: string
  message: string
  channel: CanalMessage
}

export interface Fournisseur {
  nom: string
  envoyer: (message: Message) => Promise<void>
}

export class SmsNonConfigureError extends Error {
  constructor() {
    super(
      'Aucun fournisseur SMS n’est configuré : NUXT_SMS_PROVIDER doit valoir « http » en production, '
      + 'avec NUXT_SMS_HTTP_URL et NUXT_SMS_HTTP_TOKEN.',
    )
  }
}

/** Journaux seulement — développement et tests. */
export const fournisseurJournal: Fournisseur = {
  nom: 'log',
  async envoyer({ to, message, channel }) {
    console.info(`[sms] ${channel} vers ${to} : ${message}`)
  },
}

/**
 * Passerelle HTTP générique.
 *
 * `fetch` est pris sur `globalThis` à l'appel, pas capturé à l'import : c'est
 * ce qui permet aux tests de le remplacer sans réseau.
 */
export function fournisseurHttp(config: { url: string, token: string, sender?: string }): Fournisseur {
  return {
    nom: 'http',
    async envoyer({ to, message, channel }) {
      const reponse = await globalThis.fetch(config.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${config.token}`,
        },
        body: JSON.stringify({ to, message, channel, sender: config.sender ?? 'eTontine' }),
      })
      if (!reponse.ok) {
        // Le corps de la réponse ne remonte pas : il peut contenir le message,
        // donc le code, et finir dans un journal moins protégé que la base.
        throw new Error(`[sms] la passerelle a répondu ${reponse.status}`)
      }
    },
  }
}

/** Le fournisseur en vigueur, d'après l'environnement. */
export function fournisseurConfigure(env: NodeJS.ProcessEnv = process.env): Fournisseur {
  const choix = env.NUXT_SMS_PROVIDER ?? (isDevOrTest() ? 'log' : '')

  if (choix === 'http') {
    const url = env.NUXT_SMS_HTTP_URL
    const token = env.NUXT_SMS_HTTP_TOKEN
    if (!url || !token) throw new SmsNonConfigureError()
    return fournisseurHttp({ url, token, sender: env.NUXT_SMS_SENDER })
  }

  if (choix === 'log') {
    // Refusé en production : un message écrit dans un journal n'est pas parti,
    // et le contraire ferait attendre un code qui n'arrivera jamais.
    if (!isDevOrTest() && env.NUXT_SMS_ALLOW_LOG !== '1') throw new SmsNonConfigureError()
    return fournisseurJournal
  }

  throw new SmsNonConfigureError()
}

let courant: Fournisseur | null = null

/** Pour les tests : impose un fournisseur, ou revient à celui de l'environnement. */
export function utiliserFournisseur(f: Fournisseur | null): void {
  courant = f
}

/** Envoie un message par le fournisseur en vigueur. */
export async function envoyerMessage(message: Message): Promise<void> {
  const fournisseur = courant ?? fournisseurConfigure()
  await fournisseur.envoyer(message)
}

/** Le texte d'un code de connexion. Court : un SMS, une phrase, le code. */
export function texteCode(code: string, canal: CanalMessage): string {
  if (canal === 'voice') return `Votre code eTontine est ${[...code].join(', ')}. Je répète : ${[...code].join(', ')}.`
  return `${code} est votre code eTontine. Il expire dans 5 minutes. Ne le partagez avec personne.`
}
