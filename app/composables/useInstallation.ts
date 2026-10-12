import { modeInstallation, proposerDOffice } from '../utils/installation'
import type { Installation } from '../utils/installation'

/**
 * Installer eTontine — la fenêtre qui le propose, et ce qu'elle sait.
 *
 * La fenêtre est ouverte de deux façons : d'office, sur le tableau de bord,
 * quand la plateforme a un chemin sûr et qu'on ne l'a pas écartée depuis
 * trente jours ; et à la demande, depuis le profil, où elle reste disponible
 * pour qui l'a fermée trop vite.
 */

/** L'invitation du navigateur (`beforeinstallprompt`), absente des types du DOM. */
export interface InvitationInstallation extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed', platform: string }>
}

// Un seul état pour toute la visite, et seulement dans le navigateur : le
// plugin qui l'alimente et les écrans qui le lisent ne tournent jamais côté
// serveur. L'invitation n'a rien de sérialisable — d'où l'état de module
// plutôt que `useState`.
const invitation = shallowRef<InvitationInstallation | null>(null)
const installeeCetteVisite = ref(false)
const ouverte = ref(false)
let proposeeCetteVisite = false

/**
 * La date de la dernière proposition écartée. Clé reprise de l'ancien
 * bandeau : un « plus tard » donné avant reste valable. Un confort par
 * appareil, rien de plus — d'où le `localStorage` et ses `try`.
 */
const CLE_REPORT = 'etontine-installation-refusee'

/** Le tableau de bord s'affiche d'abord ; la proposition vient ensuite, sans couper un geste. */
export const DELAI_PROPOSITION_MS = 3000

function lireReport(): number | null {
  try {
    const valeur = Number(localStorage.getItem(CLE_REPORT) ?? 0)
    return valeur > 0 ? valeur : null
  }
  catch {
    return null
  }
}

function retenirReport() {
  try {
    localStorage.setItem(CLE_REPORT, String(Date.now()))
  }
  catch {
    // Sans stockage, la proposition reviendra à la prochaine visite. Acceptable.
  }
}

/** Ouverte en application : depuis l'écran d'accueil, le Dock, ou sa propre fenêtre. */
function estAutonome(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: window-controls-overlay)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

/** Pour le plugin : le navigateur propose l'installation. On garde son invitation. */
export function retenirInvitation(evenement: InvitationInstallation) {
  invitation.value = evenement
}

/** Pour le plugin : l'installation est faite — par notre bouton ou par le menu du navigateur. */
export function signalerInstallation() {
  invitation.value = null
  installeeCetteVisite.value = true
  ouverte.value = false
}

export function useInstallation() {
  const installation = computed<Installation>(() => {
    if (import.meta.server) return { mode: 'non-pris-en-charge', dOffice: false }
    if (installeeCetteVisite.value) return { mode: 'installee', dOffice: false }
    return modeInstallation({
      userAgent: navigator.userAgent,
      pointsDeContact: navigator.maxTouchPoints ?? 0,
      autonome: estAutonome(),
      invitationDisponible: invitation.value !== null,
    })
  })

  function ouvrir() {
    ouverte.value = true
  }

  /** Fermer, de quelque façon que ce soit, c'est remettre à plus tard : trente jours. */
  function fermer() {
    if (!ouverte.value) return
    ouverte.value = false
    retenirReport()
  }

  /**
   * La fenêtre du navigateur. Son invitation ne sert qu'une fois : on la
   * lâche avant même la réponse. Refusée là-bas, c'est un « plus tard ».
   */
  async function installer(): Promise<boolean> {
    const evenement = invitation.value
    if (!evenement) return false
    invitation.value = null

    await evenement.prompt()
    const { outcome } = await evenement.userChoice
    if (outcome === 'accepted') {
      signalerInstallation()
      return true
    }
    fermer()
    return false
  }

  function proposerSiOpportun() {
    if (ouverte.value) return
    const opportun = proposerDOffice(installation.value, {
      reporteeLe: lireReport(),
      maintenant: Date.now(),
      dejaProposee: proposeeCetteVisite,
    })
    if (!opportun) return
    proposeeCetteVisite = true
    ouverte.value = true
  }

  /**
   * La proposition d'office, sur le tableau de bord seulement.
   *
   * Pas ailleurs : quelqu'un qui arrive d'une notification sur l'écran
   * « cotiser » est au milieu d'un geste d'argent, et une fenêtre qui s'ouvre
   * par-dessus lui ferait perdre le fil. Et pas tout de suite : l'écran
   * s'affiche, puis la proposition vient. L'invitation du navigateur arrive
   * souvent après l'affichage — elle relance l'attente.
   */
  function surveiller() {
    const route = useRoute()
    let minuterie: ReturnType<typeof setTimeout> | undefined

    function planifier() {
      clearTimeout(minuterie)
      if (route.path !== '/app') return
      minuterie = setTimeout(proposerSiOpportun, DELAI_PROPOSITION_MS)
    }

    onMounted(planifier)
    watch(() => route.path, planifier)
    watch(invitation, planifier)
    onBeforeUnmount(() => clearTimeout(minuterie))
  }

  return {
    installation,
    ouverte: readonly(ouverte),
    ouvrir,
    fermer,
    installer,
    surveiller,
  }
}
