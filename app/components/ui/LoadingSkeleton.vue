<script setup lang="ts">
/**
 * L'état de chargement des cinq états obligatoires (règle 14).
 *
 * Un squelette plutôt qu'un tourniquet : il montre la forme de ce qui arrive,
 * ce qui rend l'attente plus courte et évite le saut de mise en page.
 *
 * L'animation respecte `prefers-reduced-motion` — voir la règle CSS dans
 * `app/assets/css/main.css`.
 */
withDefaults(defineProps<{
  variant?: 'text' | 'card' | 'list'
  /** Nombre de lignes ou de cartes. */
  count?: number
}>(), {
  variant: 'text',
  count: 3,
})
</script>

<template>
  <!-- `aria-busy` et le texte de remplacement : un lecteur d'écran annonce le
       chargement au lieu de lire une suite de blocs vides. -->
  <div
    class="flex flex-col gap-3"
    role="status"
    aria-busy="true"
    data-testid="loading-skeleton"
  >
    <span class="sr-only">Chargement en cours</span>

    <template v-if="variant === 'text'">
      <span
        v-for="i in count"
        :key="i"
        class="skeleton h-4 rounded"
        :class="i === count ? 'w-2/3' : 'w-full'"
        aria-hidden="true"
      />
    </template>

    <template v-else-if="variant === 'card'">
      <div
        v-for="i in count"
        :key="i"
        class="flex flex-col gap-3 rounded-card border border-line p-4"
        aria-hidden="true"
      >
        <span class="skeleton h-5 w-1/2 rounded" />
        <span class="skeleton h-4 w-full rounded" />
        <span class="skeleton h-4 w-3/4 rounded" />
      </div>
    </template>

    <template v-else>
      <div
        v-for="i in count"
        :key="i"
        class="flex items-center gap-3 rounded-card border border-line p-3"
        aria-hidden="true"
      >
        <span class="skeleton size-touch shrink-0 rounded-full" />
        <span class="flex flex-1 flex-col gap-2">
          <span class="skeleton h-4 w-1/2 rounded" />
          <span class="skeleton h-3 w-1/3 rounded" />
        </span>
      </div>
    </template>
  </div>
</template>
