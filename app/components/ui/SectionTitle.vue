<script setup lang="ts">
/**
 * Titre de section avec action à droite — repris de `SectionTitle` du template.
 *
 * `niveau` existe parce qu'un titre de section n'est pas toujours un `<h2>` :
 * dans un onglet déjà titré, c'est un `<h3>`. Un composant qui rendrait
 * toujours `<h2>` casserait la hiérarchie de titres, que les lecteurs d'écran
 * utilisent pour naviguer.
 */
withDefaults(defineProps<{
  niveau?: 2 | 3
}>(), {
  niveau: 2,
})
</script>

<template>
  <div class="flex items-end justify-between gap-3">
    <component
      :is="`h${niveau}`"
      class="text-base font-bold text-ink"
    >
      <slot />
    </component>
    <slot name="action" />
  </div>
</template>
