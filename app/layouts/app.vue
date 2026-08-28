<script setup lang="ts">
/**
 * Mise en page de l'application authentifiée.
 *
 * Le bandeau hors-ligne est ici et non dans chaque page : la coupure réseau
 * concerne toute l'application, et un écran qui l'oublierait laisserait le
 * membre croire que sa déclaration est partie.
 */
const session = useSessionStore()
await session.charger()
</script>

<template>
  <div class="flex min-h-dvh flex-col bg-surface-muted">
    <OfflineBanner />

    <header class="sticky top-0 z-10 border-b border-line bg-surface">
      <div class="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-3">
        <NuxtLink
          to="/app"
          class="min-h-touch flex items-center gap-2 font-semibold text-ink"
        >
          <Icon
            name="lucide:hand-coins"
            size="1.25rem"
            class="text-brand"
            aria-hidden="true"
          />
          Tontine CI
        </NuxtLink>

        <NuxtLink
          to="/app/profil"
          class="min-h-touch flex items-center gap-2 rounded-control px-2 text-sm text-ink-muted"
          data-testid="lien-profil"
        >
          <Icon
            name="lucide:circle-user"
            size="1.5rem"
            aria-hidden="true"
          />
          <span class="sr-only">Mon profil</span>
        </NuxtLink>
      </div>
    </header>

    <main class="mx-auto w-full max-w-2xl flex-1 px-4 py-5">
      <slot />
    </main>
  </div>
</template>
