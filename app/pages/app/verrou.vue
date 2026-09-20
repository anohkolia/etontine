<script setup lang="ts">
/**
 * Écran de verrouillage.
 *
 * Pas de mise en page d'application : ni en-tête, ni barre d'onglets, ni
 * compteur de notifications. Tant que le code n'est pas saisi, l'écran ne dit
 * rien de la tontine — c'est tout l'objet du verrou.
 *
 * Le code demandé est le code d'accès du compte, et les essais comptent
 * comme à la connexion : cinq échecs bloquent, dix verrouillent le compte.
 * La sortie de secours est « code oublié », par e-mail — elle passe par la
 * déconnexion, puisque le nouveau code ouvre une nouvelle session.
 */
definePageMeta({ layout: false, middleware: 'auth' })
const { t } = useI18n()

const session = useSessionStore()
const verrou = useVerrou()
const route = useRoute()

const code = ref('')
const enCours = ref(false)
const erreur = ref<string | null>(null)
const oublie = ref(false)

/** Où aller une fois déverrouillé : là d'où l'on venait, sinon l'accueil. */
const destination = computed(() => {
  const demandee = route.query.redirect
  return typeof demandee === 'string' && /^\/app(?!\/verrou)/.test(demandee) ? demandee : '/app'
})

onMounted(() => {
  verrou.rafraichir()
  if (verrou.deverrouille.value) navigateTo(destination.value, { replace: true })
})

async function deverrouiller() {
  erreur.value = null
  enCours.value = true
  try {
    await $fetch<{ ok: true }>('/api/v1/auth/pin/verify', { method: 'POST', body: { code: code.value } })
    verrou.deverrouiller()
    await navigateTo(destination.value, { replace: true })
  }
  catch (e) {
    code.value = ''
    erreur.value = (e as { data?: { error?: { message?: string } } })?.data?.error?.message
      ?? t('commun.serveur_injoignable')
  }
  finally {
    enCours.value = false
  }
}

async function reinitialiser() {
  await $fetch('/api/v1/auth/logout', { method: 'POST' })
  session.expirer()
  await navigateTo('/code-oublie')
}

useHead({ title: t('verrou.verrouille_etontine') })
</script>

<template>
  <div class="flex min-h-dvh flex-col bg-surface">
    <OfflineBanner nature="reseau-requis" />

    <main class="mx-auto flex w-full max-w-sm flex-1 flex-col gap-6 px-6 py-10">
      <header class="flex flex-col items-center gap-3 text-center">
        <span
          class="flex size-14 items-center justify-center rounded-full bg-brand-surface text-brand-strong"
          aria-hidden="true"
        >
          <Icon
            name="lucide:lock"
            size="1.5rem"
          />
        </span>
        <h1 class="text-2xl font-bold text-ink">
          {{ $t('verrou.ton_code') }}
        </h1>
        <p class="text-ink-muted">
          {{ $t('verrou.l_application_est_verrouillee') }}
        </p>
      </header>

      <form
        class="flex flex-1 flex-col gap-4"
        @submit.prevent="deverrouiller"
      >
        <label
          class="sr-only"
          for="code-verrou"
        >{{ $t('verrou.code_d_acces') }}</label>
        <InputText
          id="code-verrou"
          v-model="code"
          type="password"
          inputmode="numeric"
          autocomplete="current-password"
          maxlength="4"
          class="text-center text-2xl tracking-[0.5em]"
          :aria-describedby="erreur ? 'erreur-verrou' : undefined"
          data-testid="champ-code-verrou"
          @input="erreur = null"
        />

        <p
          v-if="erreur"
          id="erreur-verrou"
          role="alert"
          class="flex items-start gap-2 rounded-control bg-disputed-surface p-3 text-sm text-disputed-ink"
          data-testid="erreur-verrou"
        >
          <Icon
            name="lucide:octagon-alert"
            size="1rem"
            class="mt-0.5 shrink-0"
            aria-hidden="true"
          />
          {{ erreur }}
        </p>

        <Button
          type="submit"
          :label="enCours ? $t('commun.verification_en_cours') : $t('verrou.ouvrir')"
          :disabled="code.length !== 4 || enCours"
          class="w-full bg-brand text-brand-ink hover:bg-brand-strong"
          data-testid="bouton-deverrouiller"
        />

        <div class="mt-auto flex flex-col gap-2 pt-4 text-sm">
          <button
            type="button"
            class="min-h-touch text-left text-ink-muted underline underline-offset-4"
            data-testid="bouton-code-oublie"
            @click="oublie = !oublie"
          >
            {{ $t('verrou.code_oublie') }}
          </button>
          <div
            v-if="oublie"
            class="flex flex-col gap-3 rounded-control bg-surface-muted p-3"
            data-testid="aide-code-oublie"
          >
            <p class="text-ink-muted">
              {{ $t('verrou.reinitialise_par_email') }}
            </p>
            <Button
              type="button"
              :label="$t('verrou.reinitialiser_mon_code')"
              class="border border-line-strong bg-surface text-ink hover:bg-surface-muted"
              data-testid="bouton-reinitialiser"
              @click="reinitialiser"
            />
          </div>
        </div>
      </form>
    </main>
  </div>
</template>

<!--
  États d'écran (règle 14) :
  · chargement — dans le libellé du bouton (« Vérification… »)
  · vide       — sans objet : un formulaire n'est jamais vide
  · erreur     — message en ligne avec `role="alert"`
  · hors-ligne — <OfflineBanner> en tête : le code se vérifie côté serveur
  · contenu    — le formulaire
-->
