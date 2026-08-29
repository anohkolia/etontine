<script setup lang="ts">
/**
 * Mise en page du back-office. **Desktop-first**, contrairement à
 * l'application des membres : on examine une pièce d'identité sur un écran
 * large, pas sur un téléphone tenu d'une main.
 */
const route = useRoute()
const admin = useAdminSession()

const onglets = [
  { to: '/dossiers', libelle: 'Dossiers', icone: 'lucide:folder-check' },
  { to: '/journal', libelle: 'Journal', icone: 'lucide:scroll-text' },
]
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
            Tontine CI — administration
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
