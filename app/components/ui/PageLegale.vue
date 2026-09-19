<script setup lang="ts">
/**
 * La coquille commune des pages légales : bandeau, retour, sommaire, pied.
 *
 * Publiques et pré-rendues, sans mise en page authentifiée — on y arrive
 * depuis la landing, l'écran de connexion ou une case de consentement, souvent
 * sans compte. Le retour vers l'application n'apparaît qu'une fois la session
 * connue, comme sur la page d'aide.
 */
import { EDITEUR } from '#shared/constants/editeur'

const { t } = useI18n()

defineProps<{
  titre: string
  sousTitre: string
}>()

const session = useSessionStore()
onMounted(() => session.charger())

const retour = computed(() => session.connecte
  ? { to: '/app', label: t('commun.mes_tontines') }
  : { to: '/', label: t('commun.retour_accueil') })

const revision = EDITEUR.revision
</script>

<template>
  <div class="min-h-dvh bg-surface-muted">
    <OfflineBanner nature="lecture" />

    <header class="gradient-trust rounded-b-tile px-6 pt-6 pb-10 text-night-ink">
      <div class="mx-auto max-w-2xl">
        <NuxtLink
          :to="retour.to"
          class="min-h-touch inline-flex items-center gap-1 text-xs font-semibold text-night-ink/75 hover:text-night-ink"
          data-testid="legal-retour"
        >
          <Icon
            name="lucide:arrow-left"
            size="0.875rem"
            aria-hidden="true"
          />
          {{ retour.label }}
        </NuxtLink>
        <h1
          class="mt-2 text-2xl font-bold"
          data-testid="legal-titre"
        >
          {{ titre }}
        </h1>
        <p class="mt-1 text-night-ink/75">
          {{ sousTitre }}
        </p>
      </div>
    </header>

    <main
      class="prose-legal mx-auto flex max-w-2xl flex-col gap-6 px-6 pt-8"
      :class="session.connecte ? 'pb-28' : 'pb-8'"
    >
      <slot />

      <p class="text-xs text-ink-subtle">
        {{ $t('ui.PageLegale.derniere_revision_p0', { p0: revision }) }}
      </p>

      <nav
        class="flex flex-wrap gap-4 border-t border-line pt-4 text-sm"
        :aria-label="$t('ui.PageLegale.pages_legales')"
      >
        <NuxtLink
          to="/legal/mentions"
          class="min-h-touch inline-flex items-center text-brand underline underline-offset-4"
        >
          {{ $t('ui.PageLegale.mentions_legales') }}
        </NuxtLink>
        <NuxtLink
          to="/legal/cgu"
          class="min-h-touch inline-flex items-center text-brand underline underline-offset-4"
        >
          {{ $t('ui.PageLegale.conditions_d_utilisation') }}
        </NuxtLink>
        <NuxtLink
          to="/legal/confidentialite"
          class="min-h-touch inline-flex items-center text-brand underline underline-offset-4"
        >
          {{ $t('ui.PageLegale.confidentialite') }}
        </NuxtLink>
      </nav>
    </main>

    <ClientOnly>
      <BarreOnglets v-if="session.connecte" />
    </ClientOnly>
  </div>
</template>

<style>
/* Les textes légaux sont longs : une hiérarchie lisible sans classes à chaque
   paragraphe. Portée limitée à ce conteneur. */
.prose-legal h2 {
  font-weight: 700;
  color: var(--color-ink);
  font-size: 1.125rem;
  margin-top: 0.5rem;
}
.prose-legal h3 {
  font-weight: 600;
  color: var(--color-ink);
  margin-top: 0.25rem;
}
.prose-legal p, .prose-legal li {
  color: var(--color-ink-muted);
  line-height: 1.6;
}
.prose-legal ul {
  list-style: disc;
  padding-left: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.prose-legal section {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
</style>
