<script setup lang="ts" generic="K extends StatusKind">
import type { StatusKind, StatusOf } from '#shared/constants/statuts'
import { statusPresentation } from '#shared/constants/statuts'

/**
 * Affiche un statut par **trois** signaux simultanés : une couleur, une icône
 * et un mot (règle 10 de CLAUDE.md).
 *
 * Le mot n'est jamais masqué, même en version compacte : `compact` réduit les
 * marges, pas l'information. Un badge réduit à une pastille de couleur serait
 * illisible pour une partie des membres, et indéchiffrable en photocopie noir
 * et blanc du procès-verbal (T20).
 */
const props = defineProps<{
  /** La machine à états concernée : cotisation, tour, versement, membre, tontine. */
  kind: K
  /** Le statut, restreint par le type à ceux que cette machine connaît. */
  status: StatusOf<K>
  compact?: boolean
}>()

const presentation = computed(() => statusPresentation(props.kind, props.status))
</script>

<template>
  <span
    class="inline-flex items-center gap-1.5 rounded-full font-medium"
    :class="[
      presentation.surface,
      presentation.ink,
      compact ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm',
    ]"
    data-testid="status-badge"
    :data-status="status"
  >
    <!-- L'icône double la couleur ; elle est décorative, le mot juste après
         porte l'information pour les lecteurs d'écran. -->
    <Icon
      :name="presentation.icon"
      class="shrink-0"
      :size="compact ? '0.875rem' : '1rem'"
      aria-hidden="true"
      data-testid="status-badge-icon"
    />
    <span data-testid="status-badge-label">{{ presentation.label }}</span>
  </span>
</template>
