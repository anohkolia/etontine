<script setup lang="ts">
/**
 * L'état d'erreur des cinq états obligatoires (règle 14).
 *
 * Deux principes : on dit ce qui s'est passé en français courant, et on offre
 * toujours une porte de sortie. Un écran d'erreur sans bouton « Réessayer »
 * laisse le membre bloqué avec une cotisation en attente.
 *
 * Aucun montant n'apparaît dans un message d'erreur.
 */
withDefaults(defineProps<{
  title?: string
  description?: string
  /** Détail technique, replié : utile au support, jamais imposé au membre. */
  detail?: string
}>(), {
  title: 'Quelque chose n’a pas fonctionné',
  description: 'Réessaie dans un instant. Si cela se reproduit, préviens le bureau de ta tontine.',
})

const emit = defineEmits<{ retry: [] }>()
</script>

<template>
  <div
    class="flex flex-col items-center gap-3 rounded-card border border-disputed-ink/20 bg-disputed-surface px-6 py-8 text-center"
    data-testid="error-state"
    role="alert"
  >
    <Icon
      name="lucide:octagon-alert"
      size="2rem"
      class="text-disputed-ink"
      aria-hidden="true"
    />
    <p class="text-lg font-semibold text-disputed-ink">
      {{ title }}
    </p>
    <p class="max-w-sm text-sm text-disputed-ink">
      {{ description }}
    </p>

    <details
      v-if="detail"
      class="w-full max-w-sm text-left"
    >
      <summary class="cursor-pointer text-xs text-disputed-ink underline underline-offset-4">
        Détail technique
      </summary>
      <p class="mt-1 font-mono text-xs break-words text-disputed-ink">
        {{ detail }}
      </p>
    </details>

    <button
      type="button"
      class="min-h-touch mt-1 inline-flex items-center gap-2 rounded-control bg-disputed-ink px-5 text-base font-semibold text-surface focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
      data-testid="error-retry"
      @click="emit('retry')"
    >
      <Icon
        name="lucide:refresh-cw"
        size="1rem"
        aria-hidden="true"
      />
      Réessayer
    </button>
  </div>
</template>
