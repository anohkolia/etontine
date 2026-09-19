<script setup lang="ts">
/**
 * L'erreur d'un champ, sous l'entrée qu'elle concerne.
 *
 * Toujours la même forme — mot, icône, couleur (règle 10) — et un
 * `role="alert"` pour que le lecteur d'écran la lise au moment où elle
 * apparaît. L'identifiant sert à `aria-describedby` sur l'entrée.
 */
defineProps<{
  message?: string
  id?: string
}>()
</script>

<template>
  <span
    v-if="message"
    :id="id"
    role="alert"
    class="flex items-start gap-1.5 text-sm font-normal text-disputed-ink"
    data-testid="erreur-champ"
  >
    <Icon
      name="lucide:octagon-alert"
      size="0.875rem"
      class="mt-0.5 shrink-0"
      aria-hidden="true"
    />
    {{ message }}
  </span>
</template>
