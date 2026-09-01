<script setup lang="ts">
import type { paymentChannel } from '#shared/schemas'
import type { z } from 'zod'
import { channelPresentation } from '#shared/constants/statuts'

/**
 * Pastille de canal de paiement — reprise de `CanalPill` du template.
 *
 * Comme `<StatusBadge>`, elle rend toujours le mot à côté de la couleur : un
 * registre relu en photocopie noir et blanc (le procès-verbal de T20) doit
 * rester lisible.
 */
const props = defineProps<{
  canal: z.infer<typeof paymentChannel>
  compact?: boolean
}>()

const presentation = computed(() => channelPresentation(props.canal))
</script>

<template>
  <span
    class="inline-flex items-center gap-1.5 rounded-full font-semibold"
    :class="[
      presentation.surface,
      presentation.ink,
      compact ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm',
    ]"
    data-testid="canal-pill"
    :data-canal="canal"
  >
    <Icon
      :name="presentation.icon"
      class="shrink-0"
      :size="compact ? '0.875rem' : '1rem'"
      aria-hidden="true"
    />
    {{ presentation.label }}
  </span>
</template>
