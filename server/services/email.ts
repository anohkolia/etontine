import { isDevOrTest } from '../utils/env.ts'

/**
 * Envoi d'e-mails.
 *
 * Le point d'entrée unique pour tout ce qui part vers une boîte mail : le lien
 * de confirmation d'inscription, le lien de réinitialisation du code, l'avis
 * de changement d'adresse ou de numéro. Le SMS n'existe plus : c'est l'e-mail
 * qui prouve qu'un compte appartient à quelqu'un.
 *
 * Le fournisseur se choisit par `NUXT_EMAIL_PROVIDER` :
 *
 * - `log` — le message est écrit dans les journaux. C'est le seul mode admis
 *   hors production, et il est **refusé** en production : un lien qui ne
 *   part pas doit faire échouer la demande, pas la laisser croire envoyée.
 * - `resend` — l'API HTTP de Resend, en un `fetch`, sans bibliothèque :
 *   `NUXT_EMAIL_RESEND_API_KEY` et `NUXT_EMAIL_FROM` (une adresse sur un
 *   domaine vérifié chez eux).
 *
 * Brancher un autre fournisseur revient à écrire une fonction de plus ici.
 */
export interface Email {
  to: string
  subject: string
  /** Texte brut. Pas de HTML : un lien se lit et se copie, c'est tout ce qu'on demande. */
  text: string
}

export interface FournisseurEmail {
  nom: string
  envoyer: (email: Email) => Promise<void>
}

export class EmailNonConfigureError extends Error {
  constructor() {
    super(
      'Aucun fournisseur d’e-mail n’est configuré : NUXT_EMAIL_PROVIDER doit valoir « resend » en production, '
      + 'avec NUXT_EMAIL_RESEND_API_KEY et NUXT_EMAIL_FROM.',
    )
  }
}

/** Journaux seulement — développement et tests. */
export const fournisseurJournal: FournisseurEmail = {
  nom: 'log',
  async envoyer({ to, subject, text }) {
    console.info(`[email] vers ${to} — ${subject}\n${text}`)
  },
}

/**
 * Resend, par son API HTTP.
 *
 * `fetch` est pris sur `globalThis` à l'appel, pas capturé à l'import : c'est
 * ce qui permet aux tests de le remplacer sans réseau.
 */
export function fournisseurResend(config: { apiKey: string, from: string }): FournisseurEmail {
  return {
    nom: 'resend',
    async envoyer({ to, subject, text }) {
      const reponse = await globalThis.fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({ from: config.from, to: [to], subject, text }),
      })
      if (!reponse.ok) {
        // Le corps de la réponse ne remonte pas : il peut reprendre le message,
        // donc le lien, et finir dans un journal moins protégé que la base.
        throw new Error(`[email] Resend a répondu ${reponse.status}`)
      }
    },
  }
}

/** Le fournisseur en vigueur, d'après l'environnement. */
export function fournisseurEmailConfigure(env: NodeJS.ProcessEnv = process.env): FournisseurEmail {
  const choix = env.NUXT_EMAIL_PROVIDER ?? (isDevOrTest() ? 'log' : '')

  if (choix === 'resend') {
    const apiKey = env.NUXT_EMAIL_RESEND_API_KEY
    const from = env.NUXT_EMAIL_FROM
    if (!apiKey || !from) throw new EmailNonConfigureError()
    return fournisseurResend({ apiKey, from })
  }

  if (choix === 'log') {
    // Refusé en production : un message écrit dans un journal n'est pas parti,
    // et le contraire ferait attendre un lien qui n'arrivera jamais.
    if (!isDevOrTest() && env.NUXT_EMAIL_ALLOW_LOG !== '1') throw new EmailNonConfigureError()
    return fournisseurJournal
  }

  throw new EmailNonConfigureError()
}

let courant: FournisseurEmail | null = null

/** Pour les tests : impose un fournisseur, ou revient à celui de l'environnement. */
export function utiliserFournisseurEmail(f: FournisseurEmail | null): void {
  courant = f
}

/** Envoie un e-mail par le fournisseur en vigueur. */
export async function envoyerEmail(email: Email): Promise<void> {
  const fournisseur = courant ?? fournisseurEmailConfigure()
  await fournisseur.envoyer(email)
}

/** L'adresse publique de l'application, pour construire les liens. */
function siteUrl(): string {
  return (process.env.NUXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
}

/**
 * Les messages, en un seul endroit.
 *
 * Courts, en texte brut, et **sans montant ni nom de tontine** : une boîte
 * mail se partage autant qu'un téléphone. Le lien est seul sur sa ligne pour
 * que les clients mail le rendent cliquable.
 */
export const messages = {
  confirmation(token: string): Omit<Email, 'to'> {
    return {
      subject: 'Confirme ton inscription à eTontine',
      text: `Bienvenue sur eTontine.\n\nPour confirmer ton compte, ouvre ce lien (valable 24 heures) :\n\n${siteUrl()}/confirmer?token=${token}\n\nSi tu n’es pas à l’origine de cette inscription, ignore ce message : rien ne sera créé.`,
    }
  },
  changementEmail(token: string): Omit<Email, 'to'> {
    return {
      subject: 'Confirme ta nouvelle adresse e-mail',
      text: `Pour rattacher cette adresse à ton compte eTontine, ouvre ce lien (valable 24 heures) :\n\n${siteUrl()}/confirmer?token=${token}\n\nSi tu n’as rien demandé, ignore ce message : ton adresse ne changera pas.`,
    }
  },
  reinitialisation(token: string): Omit<Email, 'to'> {
    return {
      subject: 'Réinitialise ton code eTontine',
      text: `Tu as demandé à changer ton code d’accès. Ouvre ce lien (valable 1 heure) pour en choisir un nouveau :\n\n${siteUrl()}/reinitialiser?token=${token}\n\nSi ce n’est pas toi, ignore ce message : ton code reste le même.`,
    }
  },
  compteVerrouille(token: string): Omit<Email, 'to'> {
    return {
      subject: 'Ton compte eTontine est verrouillé',
      text: `Trop de codes incorrects ont été saisis sur ton compte. Par sécurité, il est verrouillé.\n\nPour le rouvrir, choisis un nouveau code par ce lien (valable 1 heure) :\n\n${siteUrl()}/reinitialiser?token=${token}\n\nSi ce n’était pas toi, quelqu’un connaît ton numéro et essaie d’entrer : change ton code, et ne le communique à personne.`,
    }
  },
  dejaInscrit(): Omit<Email, 'to'> {
    return {
      subject: 'Tu as déjà un compte eTontine',
      text: `Quelqu’un vient d’essayer de créer un compte eTontine avec cette adresse — c’est peut-être toi.\n\nTu as déjà un compte : connecte-toi avec ton numéro et ton code. Code oublié ? Demande un nouveau lien depuis l’écran de connexion :\n\n${siteUrl()}/code-oublie\n\nSi ce n’était pas toi, ignore ce message.`,
    }
  },
  numeroChange(finNumero: string): Omit<Email, 'to'> {
    return {
      subject: 'Ton numéro eTontine a changé',
      text: `Le numéro de ton compte eTontine vient d’être remplacé par un numéro se terminant par ${finNumero}.\n\nSi ce n’est pas toi, réinitialise ton code sans attendre :\n\n${siteUrl()}/code-oublie`,
    }
  },
  emailChange(nouvelleAdresse: string): Omit<Email, 'to'> {
    return {
      subject: 'Ton adresse eTontine a changé',
      text: `L’adresse e-mail de ton compte eTontine est désormais ${nouvelleAdresse}. Cette ancienne adresse ne recevra plus rien.\n\nSi ce n’est pas toi, réinitialise ton code sans attendre :\n\n${siteUrl()}/code-oublie`,
    }
  },
}
