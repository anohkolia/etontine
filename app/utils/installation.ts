/**
 * Comment installer eTontine, selon l'appareil et le navigateur.
 *
 * Il n'existe pas de geste unique :
 *
 * - Chrome, Edge, Samsung Internet et les autres navigateurs de la famille
 *   Chromium proposent l'installation eux-mêmes (`beforeinstallprompt`) : un
 *   bouton suffit ;
 * - l'iPhone et l'iPad n'ont rien de tel. On installe depuis le menu Partager,
 *   et personne ne le devine : il faut le montrer. Depuis iOS 16.4, Chrome,
 *   Edge et Firefox le permettent aussi ; avant, seul Safari ;
 * - Safari sur Mac ajoute au Dock depuis le menu Fichier (Safari 17 et après) ;
 * - Firefox sur Android installe depuis son menu, sans jamais prévenir la page ;
 * - les navigateurs intégrés aux applications — WhatsApp, Facebook, Instagram —
 *   ne savent pas installer du tout : il faut rouvrir le lien dans le vrai
 *   navigateur. C'est par eux qu'arrivent une bonne part des invitations ;
 * - Firefox sur ordinateur ne sait pas installer (son essai sous Windows reste
 *   expérimental) : on renvoie vers Chrome, Edge ou Safari.
 *
 * Tout est déduit ici, sans toucher au navigateur : la fonction reçoit ce qu'il
 * faut savoir de l'appareil et rend la marche à suivre. C'est ce qui la rend
 * vérifiable navigateur par navigateur.
 */

/**
 * La marche à suivre :
 *
 * - `installee` — ouverte depuis l'écran d'accueil, le Dock ou sa propre
 *   fenêtre : rien à proposer ;
 * - `invite` — le navigateur a proposé l'installation : un bouton déclenche
 *   sa fenêtre ;
 * - `ios` — iPhone, iPad : Partager, puis « Sur l'écran d'accueil » ;
 * - `ios-safari` — iOS d'avant 16.4, hors Safari : seul Safari sait ajouter à
 *   l'écran d'accueil ;
 * - `safari-mac` — Safari sur Mac : Fichier, puis « Ajouter au Dock » ;
 * - `android` — Android sans invitation du navigateur : son menu, puis
 *   « Installer » ;
 * - `ordinateur` — Chrome, Edge… sur ordinateur sans invitation : l'icône
 *   d'installation, ou le menu ;
 * - `navigateur-integre` — WhatsApp, Facebook, Instagram… : rouvrir le lien
 *   dans le navigateur ;
 * - `non-pris-en-charge` — Firefox sur ordinateur, Safari d'avant 17 : passer
 *   par Chrome, Edge ou Safari.
 */
export type ModeInstallation = 'installee' | 'invite' | 'ios' | 'ios-safari' | 'safari-mac' | 'android' | 'ordinateur' | 'navigateur-integre' | 'non-pris-en-charge'

/** Ce qu'il faut savoir de l'appareil — rien de plus. */
export interface Appareil {
  userAgent: string
  /** `navigator.maxTouchPoints` : un iPad récent se présente comme un Mac, mais tactile. */
  pointsDeContact: number
  /** Ouverte en application : `display-mode: standalone`, ou `navigator.standalone` sur iOS. */
  autonome: boolean
  /** Le navigateur a proposé l'installation, et l'invitation est mise de côté. */
  invitationDisponible: boolean
}

export interface Installation {
  mode: ModeInstallation
  /**
   * La proposer sans qu'on la demande. Seulement là où le chemin est sûr :
   * sur Chrome, l'absence d'invitation veut souvent dire « déjà installée » —
   * on ne le sait pas, et l'on n'insiste pas ; le profil garde la marche à
   * suivre pour qui la cherche.
   */
  dOffice: boolean
}

/**
 * Les navigateurs intégrés aux applications.
 *
 * `; wv)` est la marque de la WebView d'Android, que toutes les applications
 * ouvrent pour afficher un lien ; les autres jetons sont ceux qu'ajoutent
 * Facebook, Instagram, Messenger, WhatsApp, TikTok, Snapchat, LinkedIn, LINE,
 * Pinterest, X et l'application Google.
 */
const NAVIGATEUR_INTEGRE = /; wv\)|FBAN|FBAV|FB_IAB|FBIOS|Instagram|Messenger|WhatsApp|TikTok|musical_ly|BytedanceWebview|Snapchat|LinkedInApp|Line\/|Pinterest|Twitter|GSA\//

/** Les navigateurs d'iOS qui ne sont pas Safari — tous moteur WebKit, mais pas Safari. */
const NAVIGATEUR_TIERS_IOS = /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|YaBrowser|DuckDuckGo/

/**
 * iOS d'avant 16.4, où seul Safari sait ajouter à l'écran d'accueil. La
 * version se lit dans « iPhone OS 15_7 » ; un iPad récent, qui se présente
 * comme un Mac, ne la donne pas — il est forcément plus récent.
 */
function iosAvant164(ua: string): boolean {
  const lu = /OS (\d+)[_.](\d+)/.exec(ua)
  if (!lu) return false
  const [majeure, mineure] = [Number(lu[1]), Number(lu[2])]
  return majeure < 16 || (majeure === 16 && mineure < 4)
}

export function modeInstallation(appareil: Appareil): Installation {
  const ua = appareil.userAgent

  if (appareil.autonome) return { mode: 'installee', dOffice: false }

  // L'invitation du navigateur fait foi : s'il propose d'installer, on le suit.
  if (appareil.invitationDisponible) return { mode: 'invite', dOffice: true }

  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && appareil.pointsDeContact > 1)

  // Sur iOS, une vue intégrée n'a pas le jeton « Safari/ » — que portent
  // Safari, mais aussi Chrome et Firefox d'iOS. Ouverte depuis l'écran
  // d'accueil, l'application ne l'a pas non plus : elle est sortie plus haut.
  if (NAVIGATEUR_INTEGRE.test(ua) || (ios && !/Safari\//.test(ua))) {
    return { mode: 'navigateur-integre', dOffice: true }
  }

  if (ios) {
    const seulSafari = NAVIGATEUR_TIERS_IOS.test(ua) && iosAvant164(ua)
    return { mode: seulSafari ? 'ios-safari' : 'ios', dOffice: true }
  }

  // Firefox sur Android installe depuis son menu et ne prévient jamais la
  // page : sans proposition d'office, personne ne le saurait. Chrome, lui, se
  // tait souvent parce que c'est déjà fait — on n'insiste pas.
  if (/Android/.test(ua)) return { mode: 'android', dOffice: /Firefox\//.test(ua) }

  const safari = /Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|Edg\/|OPR\/|Firefox\//.test(ua)
  if (safari) {
    const version = Number(/Version\/(\d+)/.exec(ua)?.[1] ?? 0)
    return version >= 17
      ? { mode: 'safari-mac', dOffice: true }
      : { mode: 'non-pris-en-charge', dOffice: false }
  }

  if (/Chrome\/|Chromium\/|Edg\//.test(ua) && !/Firefox\//.test(ua)) return { mode: 'ordinateur', dOffice: false }

  return { mode: 'non-pris-en-charge', dOffice: false }
}

/** Ce qu'un « plus tard » vaut : trente jours sans nouvelle proposition. */
export const REPORT_INSTALLATION_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Proposer d'office, ou se taire.
 *
 * Une fois par visite au plus, et jamais dans les trente jours qui suivent une
 * proposition écartée — qu'on ait remis à plus tard, refusé la fenêtre du
 * navigateur, ou lu la marche à suivre. Une fenêtre qui revient à chaque
 * ouverture fait fermer l'application, pas l'installer.
 */
export function proposerDOffice(
  installation: Installation,
  contexte: { reporteeLe: number | null, maintenant: number, dejaProposee: boolean },
): boolean {
  if (!installation.dOffice || contexte.dejaProposee) return false
  return contexte.reporteeLe === null || contexte.maintenant - contexte.reporteeLe >= REPORT_INSTALLATION_MS
}
