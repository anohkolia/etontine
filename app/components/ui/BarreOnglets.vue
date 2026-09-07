<script setup lang="ts">
/**
 * La barre d'onglets basse.
 *
 * Extraite de `layouts/app.vue` parce qu'elle doit aussi apparaître sur
 * `/aide`, qui vit hors de la mise en page de l'application : la page est
 * publique, liée depuis la landing, et ne peut pas prendre la coquille
 * authentifiée. Sans cette extraction, toucher « Aide » depuis la barre faisait
 * disparaître la barre — on se retrouvait dans un écran sans retour.
 *
 * §10 du cahier demande les actions primaires dans la zone du pouce, et la
 * navigation en fait partie : un menu en haut d'un écran de 6 pouces se
 * manœuvre à deux mains. Les cibles font 44 px de haut (règle 13) et la barre
 * respecte l'encoche basse des iPhone.
 */

/**
 * Quatre onglets. Le template en propose un cinquième, « Abonnement » : il
 * existe désormais (`/app/abonnement`) mais reste hors de la barre. On y passe
 * une fois par an, et « Aide » garde la place — le module 14 du cahier la veut
 * consultable hors connexion, ce qui en fait une destination de premier niveau.
 * Le chemin vers l'abonnement part du profil, où l'on va pour ce genre de chose.
 */
const onglets = [
  { to: '/app', label: 'Accueil', icon: 'lucide:layout-dashboard' },
  { to: '/app/tontine/create', label: 'Créer', icon: 'lucide:circle-plus' },
  { to: '/aide', label: 'Aide', icon: 'lucide:life-buoy' },
  { to: '/app/profil', label: 'Profil', icon: 'lucide:circle-user-round' },
] as const

const route = useRoute()

/** `/app` ne s'allume que sur lui-même, sinon il resterait actif partout. */
function actif(to: string): boolean {
  return to === '/app' ? route.path === '/app' : route.path.startsWith(to)
}
</script>

<template>
  <nav
    class="fixed bottom-0 left-1/2 z-30 w-full max-w-2xl -translate-x-1/2 border-t border-line bg-surface/95 px-2 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur"
    aria-label="Navigation principale"
    data-testid="barre-onglets"
  >
    <ul class="grid grid-cols-4">
      <li
        v-for="onglet in onglets"
        :key="onglet.to"
      >
        <NuxtLink
          :to="onglet.to"
          class="flex min-h-touch flex-col items-center justify-center gap-0.5 rounded-control text-[11px] font-semibold transition-colors"
          :class="actif(onglet.to) ? 'text-brand' : 'text-ink-muted hover:text-ink'"
          :aria-current="actif(onglet.to) ? 'page' : undefined"
          :data-testid="`onglet-${onglet.label.toLowerCase()}`"
        >
          <!-- L'onglet actif se distingue par la couleur **et** par le trait
               de l'icône **et** par `aria-current` : jamais la couleur seule
               (règle 10). -->
          <Icon
            :name="onglet.icon"
            size="1.25rem"
            :class="actif(onglet.to) ? 'stroke-[2.4]' : 'stroke-[1.8]'"
            aria-hidden="true"
          />
          {{ onglet.label }}
        </NuxtLink>
      </li>
    </ul>
  </nav>
</template>
