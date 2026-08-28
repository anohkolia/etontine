<script setup lang="ts">
/**
 * Affiche un montant en FCFA, et uniquement au format imposé par la règle 7 :
 * espace fine insécable en séparateur de milliers, aucune décimale, suffixe
 * `FCFA`.
 *
 * Aucun écran ne formate un montant à la main — ESLint refuse `toLocaleString`
 * dans un composant, et le passage par ce composant garantit en plus que le
 * montant ne sera jamais coupé en fin de ligne (`.amount`).
 *
 * Le montant vient **toujours** du serveur (règle 2) : ce composant affiche,
 * il ne calcule pas.
 */
const props = withDefaults(defineProps<{
  /** Entier en FCFA. `null` affiche un tiret, pas « 0 FCFA ». */
  amount: number | null | undefined
  size?: 'sm' | 'base' | 'lg' | 'xl'
  /** Grise le montant, pour un dû déjà réglé ou une valeur secondaire. */
  muted?: boolean
}>(), {
  size: 'base',
  muted: false,
})

const { formatOrDash } = useMoney()

const text = computed(() => formatOrDash(props.amount))

const sizeClass = {
  sm: 'text-sm',
  base: 'text-base',
  lg: 'text-lg font-semibold',
  xl: 'text-2xl font-bold',
} as const
</script>

<template>
  <span
    class="amount"
    :class="[sizeClass[size], muted ? 'text-ink-subtle' : 'text-ink']"
    data-testid="amount"
  >{{ text }}</span>
</template>
