<script setup lang="ts">
/**
 * Nouveau code, par le lien reçu par e-mail.
 *
 * C'est aussi la seule porte d'un compte verrouillé après dix échecs. Le
 * nouveau code ouvre la session dans la foulée.
 */
import { codeAcces } from '#shared/schemas'

definePageMeta({ layout: false })
const { t } = useI18n()

const route = useRoute()
const token = computed(() => (typeof route.query.token === 'string' ? route.query.token : ''))

const code = ref('')
const confirmation = ref('')
const enCours = ref(false)
const erreur = ref<string | null>(null)
const erreurCode = ref<string | null>(null)
const lienInvalide = ref(false)

const codesDifferents = computed(() =>
  confirmation.value.length === 4 && code.value.length === 4 && confirmation.value !== code.value,
)
const pret = computed(() => /^\d{4}$/.test(code.value) && confirmation.value === code.value && !erreurCode.value)

function verifierCode() {
  if (code.value.length === 0) return
  const resultat = codeAcces.safeParse(code.value)
  erreurCode.value = resultat.success ? null : resultat.error.issues[0]?.message ?? null
}

async function enregistrer() {
  erreur.value = null
  verifierCode()
  if (!pret.value) return
  enCours.value = true
  try {
    await $fetch('/api/v1/auth/reset/confirm', { method: 'POST', body: { token: token.value, code: code.value } })
    await useSessionStore().charger(true)
    useVerrou().deverrouiller()
    await navigateTo('/app', { replace: true })
  }
  catch (e) {
    const err = e as { statusCode?: number, data?: { error?: { message?: string, field?: string } } }
    if (err.data?.error?.field === 'token') {
      lienInvalide.value = true
    }
    else {
      erreur.value = err.data?.error?.message ?? t('commun.serveur_injoignable_connexion')
    }
  }
  finally {
    enCours.value = false
  }
}

onMounted(() => {
  if (!token.value) lienInvalide.value = true
})

useHead({ title: t('public.reinitialiser.nouveau_code_etontine') })
</script>

<template>
  <div class="flex min-h-dvh flex-col bg-surface">
    <OfflineBanner nature="reseau-requis" />

    <main class="mx-auto flex w-full max-w-sm flex-1 flex-col gap-6 px-6 py-8">
      <section
        v-if="lienInvalide"
        class="flex flex-1 flex-col items-center justify-center gap-4 text-center"
        data-testid="lien-invalide"
      >
        <span
          class="flex size-14 items-center justify-center rounded-full bg-disputed-surface text-disputed-ink"
          aria-hidden="true"
        >
          <Icon
            name="lucide:link-2-off"
            size="1.5rem"
          />
        </span>
        <h1 class="text-2xl font-bold text-ink">
          {{ $t('public.reinitialiser.lien_invalide') }}
        </h1>
        <p class="text-ink-muted">
          {{ $t('public.reinitialiser.il_a_peut_etre_expire') }}
        </p>
        <NuxtLink
          to="/code-oublie"
          class="min-h-touch inline-flex w-full items-center justify-center rounded-control bg-brand text-sm font-semibold text-brand-ink hover:bg-brand-strong"
          data-testid="lien-redemander"
        >
          {{ $t('public.reinitialiser.redemander_un_lien') }}
        </NuxtLink>
      </section>

      <template v-else>
        <header class="flex flex-col gap-2">
          <h1 class="text-2xl font-bold text-ink">
            {{ $t('public.reinitialiser.titre') }}
          </h1>
          <p class="text-ink-muted">
            {{ $t('public.reinitialiser.intro') }}
          </p>
        </header>

        <form
          class="flex flex-1 flex-col gap-4"
          @submit.prevent="enregistrer"
        >
          <label
            class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
            for="code"
          >
            {{ $t('public.reinitialiser.nouveau_code') }}
            <InputText
              id="code"
              v-model="code"
              type="password"
              inputmode="numeric"
              autocomplete="new-password"
              maxlength="4"
              class="text-center text-2xl tracking-[0.5em]"
              :aria-invalid="Boolean(erreurCode)"
              :aria-describedby="erreurCode ? 'erreur-code' : undefined"
              data-testid="champ-code"
              @input="erreurCode = null"
              @blur="verifierCode"
            />
            <ErreurChamp
              id="erreur-code"
              :message="erreurCode ?? undefined"
            />
          </label>

          <label
            class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
            for="confirmation"
          >
            {{ $t('public.reinitialiser.confirme_le_code') }}
            <InputText
              id="confirmation"
              v-model="confirmation"
              type="password"
              inputmode="numeric"
              autocomplete="new-password"
              maxlength="4"
              class="text-center text-2xl tracking-[0.5em]"
              :aria-invalid="codesDifferents"
              data-testid="champ-confirmation"
            />
            <ErreurChamp
              id="erreur-confirmation"
              :message="codesDifferents ? $t('public.reinitialiser.les_deux_codes_different') : undefined"
            />
          </label>

          <p
            v-if="erreur"
            role="alert"
            class="flex items-start gap-2 rounded-control bg-disputed-surface p-3 text-sm text-disputed-ink"
            data-testid="erreur-reinitialiser"
          >
            <Icon
              name="lucide:octagon-alert"
              size="1rem"
              class="mt-0.5 shrink-0"
              aria-hidden="true"
            />
            {{ erreur }}
          </p>

          <div class="mt-auto pt-4">
            <Button
              type="submit"
              :label="enCours ? $t('commun.enregistrement_en_cours') : $t('public.reinitialiser.enregistrer')"
              :disabled="!pret || enCours"
              class="w-full bg-brand text-brand-ink hover:bg-brand-strong"
              data-testid="bouton-enregistrer-code"
            />
          </div>
        </form>
      </template>
    </main>
  </div>
</template>

<!--
  États d'écran (règle 14) :
  · chargement — dans le libellé du bouton
  · vide       — sans objet
  · erreur     — lien mort (écran dédié) ou message en ligne
  · hors-ligne — <OfflineBanner> en tête
  · contenu    — le formulaire
-->
