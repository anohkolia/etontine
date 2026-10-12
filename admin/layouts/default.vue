<script setup lang="ts">
/**
 * Mise en page du back-office. **Desktop-first**, contrairement à
 * l'application des membres : on examine une pièce d'identité sur un écran
 * large, pas sur un téléphone tenu d'une main.
 */
const route = useRoute()
const admin = useAdminSession()
const alertes = useAlertesAdmin()

const onglets = computed(() => [
  { to: '/organisateurs', libelle: 'Organisateurs', icone: 'lucide:user-plus', alertes: alertes.organisateurs.value },
  { to: '/dossiers', libelle: 'Dossiers', icone: 'lucide:folder-check', alertes: 0 },
  { to: '/abonnements', libelle: 'Abonnements', icone: 'lucide:receipt-text', alertes: 0 },
  { to: '/journal', libelle: 'Journal', icone: 'lucide:scroll-text', alertes: 0 },
])

/**
 * Le badge se relit à chaque navigation : un organisateur qui s'inscrit
 * pendant qu'on examine un dossier doit se voir sans recharger la page.
 */
function relireAlertes() {
  if (admin.connecte.value) alertes.rafraichir()
}
onMounted(relireAlertes)
watch(() => route.path, relireAlertes)
</script>

<template>
  <div class="min-h-dvh bg-surface-muted">
    <header
      v-if="admin.connecte.value"
      class="border-b border-line bg-surface"
    >
      <div class="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-3">
        <div class="flex items-center gap-6">
          <span class="flex items-center gap-2 font-semibold text-ink">
            <Icon
              name="lucide:shield-check"
              size="1.25rem"
              class="text-brand"
              aria-hidden="true"
            />
            eTontine — administration
          </span>

          <nav class="flex items-center gap-1">
            <NuxtLink
              v-for="onglet in onglets"
              :key="onglet.to"
              :to="onglet.to"
              class="min-h-touch inline-flex items-center gap-2 rounded-control px-3 text-sm font-medium"
              :class="route.path.startsWith(onglet.to)
                ? 'bg-surface-muted text-ink'
                : 'text-ink-muted hover:bg-surface-muted'"
              :data-testid="`onglet-${onglet.libelle.toLowerCase()}`"
            >
              <Icon
                :name="onglet.icone"
                size="1rem"
                aria-hidden="true"
              />
              {{ onglet.libelle }}
              <!-- Un nombre et un mot, pas une pastille de couleur seule (règle 10). -->
              <span
                v-if="onglet.alertes > 0"
                class="tabular-nums rounded-full bg-late-surface px-2 py-0.5 text-xs font-bold text-late-ink"
                :data-testid="`alertes-${onglet.libelle.toLowerCase()}`"
              >
                {{ onglet.alertes }}<span class="sr-only"> {{ onglet.alertes > 1 ? 'nouveaux' : 'nouveau' }}</span>
              </span>
            </NuxtLink>
          </nav>
        </div>

        <div class="flex items-center gap-3 text-sm text-ink-muted">
          <span data-testid="admin-courant">{{ admin.phone.value }}</span>
          <button
            type="button"
            class="min-h-touch rounded-control px-3 underline underline-offset-4"
            data-testid="bouton-deconnexion"
            @click="admin.deconnecter()"
          >
            Fermer la session
          </button>
        </div>
      </div>
    </header>

    <main class="mx-auto w-full max-w-5xl px-6 py-6">
      <slot />
    </main>
  </div>
</template>
