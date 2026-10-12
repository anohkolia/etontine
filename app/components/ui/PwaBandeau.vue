<script setup lang="ts">
/**
 * Une nouvelle version de l'application est prête.
 *
 * Sans ce bandeau, une correction se chargeait au hasard du rechargement
 * suivant : un membre qui gardait l'application ouverte ne savait pas qu'elle
 * l'attendait.
 *
 * L'installation, qu'il proposait aussi, a sa propre fenêtre
 * (`FenetreInstallation`) : le bandeau ne la proposait qu'aux navigateurs de
 * la famille Chrome, et rien à l'iPhone, à l'iPad ni à Safari.
 */
const { $pwa } = useNuxtApp()

// `$pwa` est un objet réactif : ses références sont déjà dépliées.
const miseAJour = computed(() => $pwa?.needRefresh === true)

async function recharger() {
  await $pwa?.updateServiceWorker(true)
}
</script>

<template>
  <div
    v-if="miseAJour"
    role="status"
    class="flex items-center gap-3 border-b border-line bg-brand-surface px-4 py-2 text-sm text-brand-strong"
    data-testid="bandeau-mise-a-jour"
  >
    <Icon
      name="lucide:refresh-cw"
      size="1rem"
      class="shrink-0"
      aria-hidden="true"
    />
    <span class="flex-1">{{ $t('ui.PwaBandeau.une_nouvelle_version_est') }}</span>
    <button
      type="button"
      class="min-h-touch shrink-0 font-semibold underline underline-offset-4"
      data-testid="bouton-recharger"
      @click="recharger"
    >
      {{ $t('ui.PwaBandeau.recharger') }}
    </button>
  </div>
</template>
