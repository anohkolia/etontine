<script setup lang="ts">
/**
 * L'un des cinq états que chaque écran doit implémenter (règle 14) :
 * chargement, **vide**, erreur, hors-ligne, contenu.
 *
 * Un écran vide n'est pas une page blanche : il dit ce qui manque et ce que
 * l'on peut faire. Le libellé est fourni par l'appelant — les composants de
 * base ne portent pas de texte métier, pour que le branchement d'i18n plus
 * tard ne consiste qu'à traduire les appelants.
 */
withDefaults(defineProps<{
  title: string
  description?: string
  icon?: string
}>(), {
  icon: 'lucide:inbox',
})
</script>

<template>
  <div
    class="flex flex-col items-center gap-3 card-surface px-6 py-10 text-center"
    data-testid="empty-state"
  >
    <Icon
      :name="icon"
      size="2rem"
      class="text-ink-subtle"
      aria-hidden="true"
    />
    <p class="text-lg font-semibold text-ink">
      {{ title }}
    </p>
    <p
      v-if="description"
      class="max-w-sm text-sm text-ink-muted"
    >
      {{ description }}
    </p>
    <!-- L'action se pose en bas, sous l'explication : on lit avant d'agir. -->
    <div
      v-if="$slots.action"
      class="pt-1"
    >
      <slot name="action" />
    </div>
  </div>
</template>
