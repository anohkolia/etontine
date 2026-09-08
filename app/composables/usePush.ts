/**
 * Abonnement du navigateur aux notifications push.
 *
 * Tout était en place côté serveur — clés VAPID, envoi, table d'abonnements,
 * route d'enregistrement — et **aucun navigateur ne s'était jamais abonné** :
 * `POST /push/subscribe` n'avait pas d'appelant. Les notifications
 * s'écrivaient donc en base et n'en sortaient jamais.
 *
 * La permission se demande sur un geste explicite, jamais à l'ouverture de
 * l'application. Une demande surgie de nulle part se refuse d'un réflexe, et
 * un refus est définitif : on ne peut plus la reposer.
 */
export type EtatPush = 'indisponible' | 'non-configure' | 'refuse' | 'inactif' | 'actif'

/**
 * `base64url` → octets, la forme qu'attend `pushManager.subscribe`.
 *
 * Le tampon est alloué explicitement : `Uint8Array.from` produit un
 * `ArrayBufferLike` que `BufferSource` refuse, parce qu'il pourrait être
 * partagé entre threads.
 */
function versOctets(base64: string): Uint8Array<ArrayBuffer> {
  const complet = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/')
  const brut = atob(complet)

  const octets = new Uint8Array(new ArrayBuffer(brut.length))
  for (let i = 0; i < brut.length; i++) octets[i] = brut.charCodeAt(i)
  return octets
}

export function usePush() {
  const etat = ref<EtatPush>('indisponible')
  const erreur = ref<string | null>(null)
  const enCours = ref(false)

  const supporte = () =>
    typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window

  async function cle(): Promise<string | null> {
    const { key } = await $fetch<{ key: string | null }>('/api/v1/push/vapid-key')
    return key
  }

  /** Où en est cet appareil, sans rien demander à personne. */
  async function rafraichir() {
    if (!supporte()) {
      etat.value = 'indisponible'
      return
    }
    if (!(await cle())) {
      etat.value = 'non-configure'
      return
    }
    if (Notification.permission === 'denied') {
      etat.value = 'refuse'
      return
    }

    const enregistrement = await navigator.serviceWorker.getRegistration()
    const abonnement = await enregistrement?.pushManager.getSubscription()
    etat.value = abonnement ? 'actif' : 'inactif'
  }

  /** Demande la permission, puis enregistre l'abonnement côté serveur. */
  async function activer() {
    erreur.value = null
    enCours.value = true
    try {
      const publique = await cle()
      if (!publique) {
        etat.value = 'non-configure'
        return
      }

      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        etat.value = permission === 'denied' ? 'refuse' : 'inactif'
        return
      }

      const enregistrement = await navigator.serviceWorker.ready
      const abonnement = await enregistrement.pushManager.getSubscription()
        ?? await enregistrement.pushManager.subscribe({
          // Sans `userVisibleOnly`, les navigateurs refusent l'abonnement : on
          // ne peut pas recevoir un push silencieux.
          userVisibleOnly: true,
          applicationServerKey: versOctets(publique),
        })

      const { endpoint, keys } = abonnement.toJSON() as {
        endpoint: string
        keys: { p256dh: string, auth: string }
      }

      await $fetch('/api/v1/push/subscribe', { method: 'POST', body: { endpoint, keys } })
      etat.value = 'actif'
    }
    catch (e) {
      erreur.value = (e as { data?: { error?: { message?: string } } })?.data?.error?.message
        ?? 'Impossible d’activer les notifications sur cet appareil.'
    }
    finally {
      enCours.value = false
    }
  }

  return { etat, erreur, enCours, rafraichir, activer }
}
