<script setup lang="ts">
const { t } = useI18n()

/**
 * Jauge circulaire du pot — reprise de `PotGauge` du template.
 *
 * Elle remplace la barre horizontale : sur un écran de 360 px, l'anneau tient
 * le pourcentage, le montant collecté et l'objectif dans la même hauteur que
 * deux lignes de texte, et le pourcentage au centre se lit d'un coup d'œil.
 *
 * **Les deux montants viennent du serveur** (règle 2). Le pourcentage n'est
 * pas un calcul métier : c'est la mise en forme de deux valeurs déjà données.
 * Aucun dû, aucune amende, aucun total de pot n'est calculé ici.
 *
 * Le pourcentage est écrit en toutes lettres au centre, et l'anneau porte un
 * `role="img"` avec sa description : l'information n'est jamais portée par le
 * seul remplissage coloré (règle 10).
 */
const props = defineProps<{
  /** Montant confirmé, en FCFA entiers, calculé par le serveur. */
  collecte: number
  /** Montant attendu pour le tour, en FCFA entiers, calculé par le serveur. */
  objectif: number
  label?: string
}>()
// Le libellé par défaut vient du fichier de langue : il se calcule ici, pas
// dans `defineProps`, que le compilateur hisse hors de `setup()`.
const label = computed(() => props.label ?? t('ui.PotGauge.pot_du_tour'))

const { format } = useMoney()

const pourcentage = computed(() =>
  props.objectif > 0
    ? Math.min(100, Math.round((props.collecte / props.objectif) * 100))
    : 0,
)

const RAYON = 52
const CIRCONFERENCE = 2 * Math.PI * RAYON

const decalage = computed(() =>
  CIRCONFERENCE - (CIRCONFERENCE * pourcentage.value) / 100,
)
</script>

<template>
  <div
    class="flex items-center gap-4"
    data-testid="pot-gauge"
  >
    <div class="relative size-32 shrink-0">
      <svg
        viewBox="0 0 120 120"
        class="size-32 -rotate-90"
        role="img"
        :aria-label="$t('ui.PotGauge.pourcentage_du_pot', { p0: pourcentage })"
      >
        <circle
          cx="60"
          cy="60"
          :r="RAYON"
          fill="none"
          stroke-width="12"
          class="stroke-surface-sunken"
        />
        <circle
          cx="60"
          cy="60"
          :r="RAYON"
          fill="none"
          stroke-width="12"
          stroke-linecap="round"
          :stroke-dasharray="CIRCONFERENCE"
          :stroke-dashoffset="decalage"
          class="stroke-brand transition-[stroke-dashoffset] duration-700 motion-reduce:transition-none"
        />
      </svg>

      <div class="absolute inset-0 flex flex-col items-center justify-center">
        <span
          class="tabular text-2xl font-bold text-ink"
          data-testid="pot-pourcentage"
        >{{ pourcentage }} %</span>
        <span class="text-[10px] tracking-wide text-ink-muted uppercase">{{ $t('ui.PotGauge.collecte') }}</span>
      </div>
    </div>

    <div class="min-w-0">
      <!-- Une seule ligne : un nom de tontine long, en capitales, passait sur
           deux lignes et poussait le montant hors de la carte à 360 px. -->
      <p class="truncate text-xs tracking-wide text-ink-muted uppercase">
        {{ label }}
      </p>
      <AmountDisplay
        :amount="collecte"
        size="xl"
        data-testid="pot-collecte"
      />
      <p class="tabular text-sm text-ink-muted">
        {{ $t('ui.PotGauge.objectif_p0', { p0: format(objectif) }) }}
      </p>
    </div>
  </div>
</template>
