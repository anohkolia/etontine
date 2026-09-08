import { defineStore } from 'pinia'
import type { MembershipRole } from '#shared/schemas'

export interface SessionUser {
  id: string
  phone: string
  firstName: string | null
  lastName: string | null
  avatarUrl: string | null
  kycLevel: number
  /** L'état du dossier d'identité, distinct du palier atteint. */
  kycStatus: 'none' | 'pending_review' | 'approved' | 'rejected'
  /** Le motif du refus, obligatoire côté back-office. */
  kycRejectionReason: string | null
  kycSubmittedAt: string | null
  hasPin: boolean
}

export interface SessionMembership {
  id: string
  tontineId: string
  role: MembershipRole
  status: string
}

/**
 * Session côté client.
 *
 * **Cache d'affichage uniquement** (règle 12). Le rôle stocké ici sert à
 * masquer un bouton, jamais à autoriser une action : le serveur le revérifie à
 * chaque appel à partir de l'adhésion réelle. Un magasin persisté qui ferait
 * autorité serait falsifiable depuis la console du navigateur.
 *
 * Rien de financier n'est conservé ici : ni montant, ni statut de cotisation.
 */
export const useSessionStore = defineStore('session', () => {
  const user = ref<SessionUser | null>(null)
  const memberships = ref<SessionMembership[]>([])
  const chargee = ref(false)

  const connecte = computed(() => user.value !== null)
  const profilComplet = computed(() =>
    Boolean(user.value?.firstName && user.value?.lastName),
  )

  /** Le rôle dans une tontine donnée — pour l'affichage, pas pour l'autorisation. */
  function roleDans(tontineId: string): MembershipRole | null {
    return memberships.value.find(m => m.tontineId === tontineId)?.role ?? null
  }

  async function charger(force = false) {
    if (chargee.value && !force) return
    try {
      const reponse = await $fetch<{ user: SessionUser, memberships: SessionMembership[] }>('/api/v1/auth/me')
      user.value = reponse.user
      memberships.value = reponse.memberships
    }
    catch {
      user.value = null
      memberships.value = []
    }
    finally {
      chargee.value = true
    }
  }

  async function deconnecter() {
    await $fetch('/api/v1/auth/logout', { method: 'POST' })
    user.value = null
    memberships.value = []
    chargee.value = false
    await navigateTo('/login')
  }

  return { user, memberships, chargee, connecte, profilComplet, roleDans, charger, deconnecter }
})
