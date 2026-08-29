/**
 * Session du back-office.
 *
 * Volontairement minimale : le back-office ne met **rien** en cache localement.
 * Aucune donnée de dossier ne doit survivre à la fermeture de l'onglet sur un
 * poste de bureau qui se partage. Le magasin ne retient que l'identité de
 * l'administrateur connecté, et encore, en mémoire.
 */
export function useAdminSession() {
  const phone = useState<string | null>('admin-phone', () => null)
  const chargee = useState('admin-chargee', () => false)

  const connecte = computed(() => phone.value !== null)

  async function charger(force = false) {
    if (chargee.value && !force) return
    try {
      const { admin } = await $fetch<{ admin: { phone: string } }>('/api/auth/me')
      phone.value = admin.phone
    }
    catch {
      phone.value = null
    }
    finally {
      chargee.value = true
    }
  }

  async function deconnecter() {
    await $fetch('/api/auth/logout', { method: 'POST' })
    phone.value = null
    chargee.value = false
    await navigateTo('/')
  }

  return { phone, chargee, connecte, charger, deconnecter }
}
