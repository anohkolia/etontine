<script setup lang="ts">
/**
 * Code oublié : le numéro, et un lien part sur l'adresse du compte.
 *
 * L'écran ne dit pas si le numéro est connu — le serveur non plus. Quelqu'un
 * qui n'a pas de compte lira « si un compte existe… » et n'apprendra rien.
 */
import { resetRequestInput } from '#shared/schemas'

definePageMeta({ layout: false })
const { t } = useI18n()

const { format, extraire, estComplet } = usePhoneMask()
const demande = useFormulaire(resetRequestInput, { phone: '' })

const saisieNumero = ref('')
const enCours = ref(false)
const erreur = ref<string | null>(null)
const envoye = ref(false)
const lienDeDeveloppement = ref<string | null>(null)

const numeroAffiche = computed(() => format(saisieNumero.value))

function onSaisieNumero(evenement: Event) {
  const champ = evenement.target as HTMLInputElement
  saisieNumero.value = extraire(champ.value)
  champ.value = format(saisieNumero.value)
  demande.setFieldValue('phone', saisieNumero.value, false)
}

async function verifierNumero() {
  if (saisieNumero.value.length > 0) await demande.validerChamp('phone')
}

async function envoyer() {
  erreur.value = null
  const valeurs = await demande.valider()
  if (!valeurs) return
  enCours.value = true
  try {
    const reponse = await $fetch<{ devToken?: string }>('/api/v1/auth/reset/request', { method: 'POST', body: valeurs })
    lienDeDeveloppement.value = reponse.devToken ? `/reinitialiser?token=${reponse.devToken}` : null
    envoye.value = true
  }
  catch (e) {
    erreur.value = (e as { data?: { error?: { message?: string } } })?.data?.error?.message
      ?? t('commun.serveur_injoignable_connexion')
  }
  finally {
    enCours.value = false
  }
}

useHead({ title: t('public.code_oublie.code_oublie_etontine') })
</script>

<template>
  <div class="flex min-h-dvh flex-col bg-surface">
    <OfflineBanner nature="reseau-requis" />

    <main class="mx-auto flex w-full max-w-sm flex-1 flex-col gap-6 px-6 py-8">
      <NuxtLink
        to="/login"
        class="min-h-touch inline-flex items-center gap-1 self-start text-xs font-semibold text-ink-muted hover:text-ink"
        data-testid="lien-connexion"
      >
        <Icon
          name="lucide:arrow-left"
          size="0.875rem"
          aria-hidden="true"
        />
        {{ $t('public.code_oublie.retour_a_la_connexion') }}
      </NuxtLink>

      <section
        v-if="envoye"
        class="flex flex-1 flex-col gap-4"
        data-testid="lien-envoye"
      >
        <header class="flex flex-col items-center gap-3 text-center">
          <span
            class="flex size-14 items-center justify-center rounded-full bg-brand-surface text-brand-strong"
            aria-hidden="true"
          >
            <Icon
              name="lucide:mail-check"
              size="1.5rem"
            />
          </span>
          <h1 class="text-2xl font-bold text-ink">
            {{ $t('public.code_oublie.regarde_ta_boite') }}
          </h1>
          <p class="text-ink-muted">
            {{ $t('public.code_oublie.si_un_compte_existe') }}
          </p>
        </header>

        <p
          v-if="lienDeDeveloppement"
          class="rounded-control bg-late-surface p-2 text-sm text-late-ink"
          data-testid="lien-dev"
        >
          {{ $t('public.code_oublie.developpement_lien') }}
          <NuxtLink
            :to="lienDeDeveloppement"
            class="font-semibold break-all underline underline-offset-4"
            data-testid="lien-dev-reinitialiser"
          >{{ lienDeDeveloppement }}</NuxtLink>
        </p>
      </section>

      <template v-else>
        <header class="flex flex-col gap-2">
          <h1 class="text-2xl font-bold text-ink">
            {{ $t('public.code_oublie.titre') }}
          </h1>
          <p class="text-ink-muted">
            {{ $t('public.code_oublie.intro') }}
          </p>
        </header>

        <form
          class="flex flex-1 flex-col gap-4"
          @submit.prevent="envoyer"
        >
          <label
            class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
            for="telephone"
          >
            {{ $t('public.code_oublie.numero_de_telephone') }}
            <span class="flex items-stretch gap-2">
              <span class="flex min-h-touch shrink-0 items-center rounded-control border border-line bg-surface-muted px-3 text-base font-semibold text-ink">
                +225
              </span>
              <InputText
                id="telephone"
                :value="numeroAffiche"
                inputmode="tel"
                autocomplete="tel"
                placeholder="07 07 12 34 56"
                :aria-invalid="Boolean(demande.erreur('phone'))"
                :aria-describedby="demande.erreur('phone') ? 'erreur-telephone' : undefined"
                class="text-lg tracking-wider tabular-nums"
                data-testid="champ-telephone"
                @input="onSaisieNumero"
                @blur="verifierNumero"
              />
            </span>
            <ErreurChamp
              id="erreur-telephone"
              :message="demande.erreur('phone')"
            />
          </label>

          <p
            v-if="erreur"
            role="alert"
            class="flex items-start gap-2 rounded-control bg-disputed-surface p-3 text-sm text-disputed-ink"
            data-testid="erreur-code-oublie"
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
              :label="enCours ? $t('commun.envoi_en_cours') : $t('public.code_oublie.envoyer_le_lien')"
              :disabled="!estComplet(saisieNumero) || enCours"
              class="w-full bg-brand text-brand-ink hover:bg-brand-strong"
              data-testid="bouton-envoyer-lien"
            />
          </div>
        </form>
      </template>
    </main>
  </div>
</template>

<!--
  États d'écran (règle 14) :
  · chargement — dans le libellé du bouton (« Envoi… »)
  · vide       — sans objet
  · erreur     — message en ligne avec `role="alert"`
  · hors-ligne — <OfflineBanner> en tête
  · contenu    — le formulaire, puis « regarde ta boîte mail »
-->
