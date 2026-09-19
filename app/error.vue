<script setup lang="ts">
import type { NuxtError } from '#app'

const { t } = useI18n()

/**
 * Page d'erreur de l'application.
 *
 * Sans elle, une adresse fausse ou une panne tombait sur la page par défaut de
 * Nuxt — en anglais, avec une pile d'appels, sans aucun chemin de retour. Sur
 * un téléphone tenu au marché, c'est une application qui paraît cassée.
 *
 * Trois cas, trois phrases : la page n'existe pas, le serveur a échoué, ou le
 * réseau manque. Et toujours une sortie — l'application, ou l'accueil.
 */
const props = defineProps<{ error: NuxtError }>()

const online = useOnline()

const introuvable = computed(() => props.error.statusCode === 404)

const titre = computed(() => {
  if (!online.value) return t('error.pas_de_reseau')
  return introuvable.value ? t('error.cette_page_n_existe') : t('error.quelque_chose_s_est')
})

const explication = computed(() => {
  if (!online.value) return t('error.ton_telephone_n_est')
  if (introuvable.value) return t('error.le_lien_est_peut')
  return t('error.le_serveur_n_a')
})

/** Repartir : on efface l'erreur et on retourne dans l'application. */
function reprendre(vers: string) {
  clearError({ redirect: vers })
}

useHead({ title: `${titre.value} — eTontine` })
</script>

<template>
  <div class="flex min-h-dvh flex-col bg-surface">
    <main class="mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center gap-6 px-6 py-10 text-center">
      <span
        class="flex size-16 items-center justify-center rounded-full"
        :class="introuvable ? 'bg-surface-muted text-ink-muted' : 'bg-disputed-surface text-disputed-ink'"
        aria-hidden="true"
      >
        <Icon
          :name="!online ? 'lucide:wifi-off' : introuvable ? 'lucide:map-pin-off' : 'lucide:octagon-alert'"
          size="1.75rem"
        />
      </span>

      <div class="flex flex-col gap-2">
        <h1
          class="text-2xl font-bold text-ink"
          data-testid="titre-erreur"
        >
          {{ titre }}
        </h1>
        <p class="text-ink-muted">
          {{ explication }}
        </p>
        <!-- Le code HTTP, discret : c'est ce qu'on lit à voix haute au support. -->
        <p
          v-if="error.statusCode && error.statusCode !== 404"
          class="tabular text-xs text-ink-subtle"
          data-testid="code-erreur"
        >
          {{ $t('error.erreur_p0', { p0: error.statusCode }) }}
        </p>
      </div>

      <div class="flex w-full flex-col gap-2">
        <button
          type="button"
          class="min-h-touch inline-flex w-full items-center justify-center rounded-control bg-brand px-5 font-semibold text-brand-ink hover:bg-brand-strong"
          data-testid="bouton-retour-app"
          @click="reprendre('/app')"
        >
          {{ $t('error.retourner_a_mes_tontines') }}
        </button>
        <button
          type="button"
          class="min-h-touch inline-flex w-full items-center justify-center rounded-control border border-line-strong bg-surface px-5 font-semibold text-ink"
          data-testid="bouton-retour-accueil"
          @click="reprendre('/')"
        >
          {{ $t('error.aller_a_l_accueil') }}
        </button>
      </div>
    </main>
  </div>
</template>
