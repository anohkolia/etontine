<script setup lang="ts">
/**
 * Mise en page de l'application authentifiée — reprise de `AppShell` du
 * template : en-tête en dégradé collant, contenu au centre, barre d'onglets
 * fixée en bas.
 *
 * La barre basse vit dans `BarreOnglets` : `/aide` est publique, donc hors de
 * cette mise en page, et doit pourtant la porter — sinon toucher « Aide »
 * depuis la barre fait disparaître la barre.
 *
 * Le bandeau hors-ligne est ici et non dans chaque page : la coupure réseau
 * concerne toute l'application, et un écran qui l'oublierait laisserait le
 * membre croire que sa déclaration est partie. Ce qu'il promet, en revanche,
 * appartient à la page : voir `useNatureHorsLigne()`.
 */
const session = useSessionStore()
await session.charger()

const entete = useEnTete()

// La cloche vit dans l'en-tête et non dans la barre basse : celle-ci a quatre
// onglets et une grille à quatre colonnes, et « Aide » doit y rester — le
// module 14 la veut consultable hors connexion.
const { nonLues, rafraichirCompteur } = useNotifications()
onMounted(rafraichirCompteur)
</script>

<template>
  <div class="mx-auto flex min-h-dvh w-full max-w-2xl flex-col bg-surface-muted">
    <!-- Sans nature déclarée, le bandeau prend la plus prudente des trois : la
         file de mutations ne couvre qu'un écran, et promettre partout qu'une
         saisie est gardée ferait attendre des envois qui n'ont pas eu lieu.
         L'écran qui tient la promesse la réclame par `useNatureHorsLigne()`. -->
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

      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0 flex-1">
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
          to="/app/notifications"
          class="relative flex min-h-touch min-w-touch items-center justify-center text-night-ink/85 transition-colors hover:text-night-ink"
          data-testid="lien-notifications"
        >
          <Icon
            name="lucide:bell"
            size="1.25rem"
            aria-hidden="true"
          />
          <!-- Le nombre est écrit, pas seulement signalé par une pastille :
               une pastille seule ne dit pas s'il y a une nouvelle ou douze,
               et ne se voit pas de tout le monde (règle 10). -->
          <span
            v-if="nonLues > 0"
            class="tabular absolute top-0.5 right-0.5 min-w-4 rounded-full bg-brand px-1 text-center text-[10px] font-bold text-brand-ink"
            data-testid="compteur-notifications"
          >{{ nonLues > 9 ? '9+' : nonLues }}</span>
          <span class="sr-only">
            Mes notifications{{ nonLues > 0 ? ` — ${nonLues} non lue${nonLues > 1 ? 's' : ''}` : '' }}
          </span>
        </NuxtLink>

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

    <BarreOnglets />
  </div>
</template>
