<script setup lang="ts">
/**
 * Pastille d'initiales — reprise de l'avatar de l'en-tête du template.
 *
 * Un nom absent ne rend pas une pastille vide : on retombe sur une icône de
 * personne. Le profil n'est renseigné qu'après la première connexion, et une
 * pastille muette à cet endroit ressemble à un bug d'affichage.
 */
const props = withDefaults(defineProps<{
  prenom?: string | null
  nom?: string | null
  size?: 'sm' | 'md' | 'lg'
  /**
   * Aplat dégradé plutôt que translucide — pour les fonds clairs.
   * `gradient-brand` et non `gradient-pot` : les initiales sont du texte, et
   * l'extrémité orange du dégradé du pot ne tient pas le AA.
   */
  solide?: boolean
}>(), {
  size: 'md',
  solide: false,
})

const initiales = computed(() =>
  [props.prenom, props.nom]
    .filter((p): p is string => Boolean(p?.trim()))
    .map(p => p.trim()[0]!.toUpperCase())
    .slice(0, 2)
    .join(''),
)

const tailleClass = {
  sm: 'size-9 text-xs',
  md: 'size-touch text-sm',
  lg: 'size-16 rounded-tile text-xl',
} as const
</script>

<template>
  <span
    class="inline-flex shrink-0 items-center justify-center rounded-full font-bold"
    :class="[
      tailleClass[size],
      solide ? 'gradient-brand text-brand-ink' : 'bg-night-ink/15 text-night-ink',
    ]"
    data-testid="avatar-initiales"
  >
    <template v-if="initiales">{{ initiales }}</template>
    <Icon
      v-else
      name="lucide:user-round"
      size="1.25rem"
      aria-hidden="true"
    />
  </span>
</template>
