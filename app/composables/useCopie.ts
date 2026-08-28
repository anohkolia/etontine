/**
 * Copie dans le presse-papiers, avec repli.
 *
 * `navigator.clipboard` n'existe **que** dans un contexte sécurisé. En
 * développement sur une adresse IP locale, ou derrière un proxy mal configuré,
 * il est absent — et un bouton « Copier » qui ne copie pas est pire que pas de
 * bouton du tout : le membre croit avoir le numéro et colle autre chose dans
 * son application de paiement.
 *
 * Le repli par `execCommand` est obsolète mais fonctionne partout, y compris
 * sur les navigateurs Android anciens qui font le gros du parc.
 */
export function useCopie() {
  const copie = ref(false)
  let minuterie: ReturnType<typeof setTimeout> | undefined

  async function copier(texte: string): Promise<boolean> {
    let reussi: boolean

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(texte)
        reussi = true
      }
      else {
        const zone = document.createElement('textarea')
        zone.value = texte
        zone.setAttribute('readonly', '')
        zone.style.position = 'fixed'
        zone.style.opacity = '0'
        document.body.appendChild(zone)
        zone.select()
        zone.setSelectionRange(0, texte.length) // iOS ignore `select()` seul
        reussi = document.execCommand('copy')
        document.body.removeChild(zone)
      }
    }
    catch {
      reussi = false
    }

    copie.value = reussi
    clearTimeout(minuterie)
    if (reussi) minuterie = setTimeout(() => (copie.value = false), 2000)

    return reussi
  }

  onBeforeUnmount(() => clearTimeout(minuterie))

  return { copie, copier }
}
