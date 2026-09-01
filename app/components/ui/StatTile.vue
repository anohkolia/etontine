<script setup lang="ts">
/**
 * Tuile de chiffre-clé — reprise de `Stat` du template.
 *
 * Une étiquette en capitales, une valeur en gros, un commentaire facultatif.
 * Deux par ligne à 360 px, quatre à partir de `sm`.
 *
 * `ton` change la couleur de la valeur, mais l'écran doit rester lisible sans
 * elle : la tuile qui compte des impayés dit « impayés » dans son étiquette,
 * le rouge ne fait que le souligner (règle 10).
 */
withDefaults(defineProps<{
  label: string
  /** Déjà formatée. Pour un montant, passer par `<AmountDisplay>` via le slot. */
  value?: string
  hint?: string
  ton?: 'neutre' | 'alerte' | 'accent'
}>(), {
  ton: 'neutre',
})

const tonClass = {
  neutre: 'text-ink',
  alerte: 'text-disputed-ink',
  accent: 'text-accent-ink',
} as const
</script>

<template>
  <div
    class="card-surface p-4"
    data-testid="stat-tile"
  >
    <p class="text-[11px] tracking-wide text-ink-muted uppercase">
      {{ label }}
    </p>
    <p
      class="tabular text-xl font-bold"
      :class="tonClass[ton]"
    >
      <slot>{{ value }}</slot>
    </p>
    <p
      v-if="hint"
      class="mt-0.5 text-xs text-ink-muted"
    >
      {{ hint }}
    </p>
  </div>
</template>
