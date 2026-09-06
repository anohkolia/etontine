<script setup lang="ts">
/**
 * Mise en page de l'application authentifiée — reprise de `AppShell` du
 * template : en-tête en dégradé collant, contenu au centre, barre d'onglets
 * fixée en bas.
 *
 * La barre basse n'est pas cosmétique. §10 du cahier demande les actions
 * primaires dans la zone du pouce, et la navigation en fait partie : un menu
 * en haut d'un écran de 6 pouces se manœuvre à deux mains. Les cibles font
 * 44 px de haut (règle 13) et la barre respecte l'encoche basse des iPhone.
 *
 * Le bandeau hors-ligne est ici et non dans chaque page : la coupure réseau
 * concerne toute l'application, et un écran qui l'oublierait laisserait le
 * membre croire que sa déclaration est partie.
 */
const session = useSessionStore()
await session.charger()

const entete = useEnTete()
const route = useRoute()

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

/** `/app` ne s'allume que sur lui-même, sinon il resterait actif partout. */
function actif(to: string): boolean {
  return to === '/app' ? route.path === '/app' : route.path.startsWith(to)
}
</script>

<template>
  <div class="mx-auto flex min-h-dvh w-full max-w-2xl flex-col bg-surface-muted">
    <OfflineBanner />

    <header
      class="gradient-trust sticky top-0 z-20 rounded-b-tile px-4 pt-4 pb-5 text-night-ink shadow-float"
    >
      <NuxtLink
        v-if="entete.retour"
        :to="entete.retour.to"
        class="mb-2 inline-flex min-h-touch items-center gap-1 text-xs font-semibold text-night-ink/75 transition-colors hover:text-night-ink"
        data-testid="entete-retour"
      >
        <Icon
          name="lucide:arrow-left"
          size="0.875rem"
          aria-hidden="true"
        />
        {{ entete.retour.label }}
      </NuxtLink>

      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <h1
            class="truncate text-lg font-bold"
            data-testid="entete-titre"
          >
            {{ entete.titre }}
          </h1>
          <p
            v-if="entete.sousTitre"
            class="mt-0.5 truncate text-xs text-night-ink/75"
            data-testid="entete-sous-titre"
          >
            {{ entete.sousTitre }}
          </p>
        </div>

        <NuxtLink
          to="/app/profil"
          class="flex min-h-touch min-w-touch items-center justify-center"
          data-testid="lien-profil"
        >
          <AvatarInitiales
            :prenom="session.user?.firstName"
            :nom="session.user?.lastName"
          />
          <span class="sr-only">Mon profil</span>
        </NuxtLink>
      </div>
    </header>

    <!-- La marge basse laisse passer la barre d'onglets : sans elle, le
         dernier bouton d'une page longue se retrouve dessous, inatteignable. -->
    <main class="w-full flex-1 space-y-5 px-4 pt-5 pb-28">
      <slot />
    </main>

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
  </div>
</template>
