<script setup lang="ts">
/**
 * Inscription : numéro, e-mail, code à quatre chiffres.
 *
 * Le compte ne s'ouvre qu'au clic sur le lien reçu par e-mail. La page ne dit
 * jamais si le numéro ou l'adresse sont déjà pris — la réponse du serveur est
 * la même dans tous les cas, et l'écran s'y tient : quelqu'un qui a déjà un
 * compte le lira dans sa boîte mail, pas ici.
 */
import { registerInput } from '#shared/schemas'

definePageMeta({ layout: false })
const { t } = useI18n()

const { format, extraire, estComplet } = usePhoneMask()

const inscription = useFormulaire(registerInput, { phone: '', email: '', code: '' })
const [email, emailAttrs] = inscription.champ('email')

const saisieNumero = ref('')
const code = ref('')
const confirmation = ref('')
const enCours = ref(false)
const erreur = ref<string | null>(null)
const etape = ref<'formulaire' | 'envoye'>('formulaire')
const lienDeDeveloppement = ref<string | null>(null)
const renvoye = ref(false)

const numeroAffiche = computed(() => format(saisieNumero.value))

function onSaisieNumero(evenement: Event) {
  const champ = evenement.target as HTMLInputElement
  saisieNumero.value = extraire(champ.value)
  champ.value = format(saisieNumero.value)
  inscription.setFieldValue('phone', saisieNumero.value, false)
}

async function verifierNumero() {
  if (saisieNumero.value.length > 0) await inscription.validerChamp('phone')
}

/** Le code est validé à la perte de focus : c'est là qu'on apprend qu'il est trop simple. */
async function verifierCode() {
  inscription.setFieldValue('code', code.value, false)
  if (code.value.length > 0) await inscription.validerChamp('code')
}

const codesDifferents = computed(() =>
  confirmation.value.length === 4 && code.value.length === 4 && confirmation.value !== code.value,
)

const pret = computed(() =>
  estComplet(saisieNumero.value)
  && (email.value ?? '').length > 0
  && /^\d{4}$/.test(code.value)
  && confirmation.value === code.value,
)

function messageErreur(e: unknown): string {
  const data = (e as { data?: { error?: { message?: string } } })?.data
  return data?.error?.message ?? t('commun.serveur_injoignable_connexion')
}

async function envoyer(renvoi = false) {
  erreur.value = null
  inscription.setFieldValue('code', code.value, false)
  const valeurs = await inscription.valider()
  if (!valeurs) return
  enCours.value = true
  try {
    const reponse = await $fetch<{ devToken?: string }>('/api/v1/auth/register', { method: 'POST', body: valeurs })
    lienDeDeveloppement.value = reponse.devToken ? `/confirmer?token=${reponse.devToken}` : null
    etape.value = 'envoye'
    renvoye.value = renvoi
  }
  catch (e) {
    erreur.value = messageErreur(e)
  }
  finally {
    enCours.value = false
  }
}

/** Un compte déjà ouvert n'a rien à faire ici. */
onMounted(async () => {
  const session = useSessionStore()
  await session.charger()
  if (session.connecte) await navigateTo('/app', { replace: true })
})

useHead({ title: t('public.inscription.inscription_etontine') })
</script>

<template>
  <div class="flex min-h-dvh flex-col bg-surface">
    <OfflineBanner nature="reseau-requis" />

    <main class="mx-auto flex w-full max-w-sm flex-1 flex-col gap-6 px-6 py-8">
      <NuxtLink
        to="/"
        class="min-h-touch inline-flex items-center gap-1 self-start text-xs font-semibold text-ink-muted hover:text-ink"
        data-testid="lien-accueil"
      >
        <Icon
          name="lucide:arrow-left"
          size="0.875rem"
          aria-hidden="true"
        />
        {{ $t('public.login.retour_a_l_accueil') }}
      </NuxtLink>

      <!-- Étape 2 : le lien est parti -->
      <section
        v-if="etape === 'envoye'"
        class="flex flex-1 flex-col gap-4"
        data-testid="inscription-envoyee"
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
            {{ $t('public.inscription.verifie_ta_boite') }}
          </h1>
          <p class="text-ink-muted">
            {{ $t('public.inscription.un_lien_est_parti') }}
          </p>
        </header>

        <p
          v-if="lienDeDeveloppement"
          class="rounded-control bg-late-surface p-2 text-sm text-late-ink"
          data-testid="lien-dev"
        >
          {{ $t('public.inscription.developpement_lien') }}
          <NuxtLink
            :to="lienDeDeveloppement"
            class="font-semibold break-all underline underline-offset-4"
            data-testid="lien-dev-confirmer"
          >{{ lienDeDeveloppement }}</NuxtLink>
        </p>

        <p
          v-if="renvoye"
          role="status"
          class="text-sm text-ink-muted"
          data-testid="lien-renvoye"
        >
          {{ $t('public.inscription.lien_renvoye') }}
        </p>

        <p
          v-if="erreur"
          role="alert"
          class="flex items-start gap-2 rounded-control bg-disputed-surface p-3 text-sm text-disputed-ink"
          data-testid="erreur-inscription"
        >
          <Icon
            name="lucide:octagon-alert"
            size="1rem"
            class="mt-0.5 shrink-0"
            aria-hidden="true"
          />
          {{ erreur }}
        </p>

        <p class="text-sm text-ink-subtle">
          {{ $t('public.inscription.pas_recu') }}
          <button
            type="button"
            class="min-h-touch text-brand underline underline-offset-4 disabled:text-ink-subtle disabled:no-underline"
            :disabled="enCours"
            data-testid="bouton-renvoyer-lien"
            @click="envoyer(true)"
          >
            {{ $t('public.inscription.renvoyer_le_lien') }}
          </button>
        </p>

        <div class="mt-auto pt-4">
          <NuxtLink
            to="/login"
            class="min-h-touch inline-flex w-full items-center justify-center rounded-control border border-line-strong bg-surface text-sm font-semibold text-ink hover:bg-surface-muted"
          >
            {{ $t('public.inscription.se_connecter') }}
          </NuxtLink>
        </div>
      </section>

      <!-- Étape 1 : le formulaire -->
      <template v-else>
        <header class="flex flex-col gap-2">
          <h1 class="text-2xl font-bold text-ink">
            {{ $t('public.inscription.titre') }}
          </h1>
          <p class="text-ink-muted">
            {{ $t('public.inscription.intro') }}
          </p>
        </header>

        <form
          class="flex flex-1 flex-col gap-4"
          @submit.prevent="envoyer()"
        >
          <label
            class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
            for="telephone"
          >
            {{ $t('public.inscription.numero_de_telephone') }}
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
                :aria-invalid="Boolean(inscription.erreur('phone'))"
                :aria-describedby="inscription.erreur('phone') ? 'erreur-telephone' : undefined"
                class="text-lg tracking-wider tabular-nums"
                data-testid="champ-telephone"
                @input="onSaisieNumero"
                @blur="verifierNumero"
              />
            </span>
            <ErreurChamp
              id="erreur-telephone"
              :message="inscription.erreur('phone')"
            />
          </label>
          <p class="text-sm text-ink-subtle">
            {{ $t('public.inscription.un_numero_ivoirien_01') }}
          </p>

          <label
            class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
            for="email"
          >
            {{ $t('public.inscription.adresse_e_mail') }}
            <InputText
              id="email"
              v-model="email"
              v-bind="emailAttrs"
              type="email"
              inputmode="email"
              autocomplete="email"
              placeholder="aya@exemple.ci"
              :aria-invalid="Boolean(inscription.erreur('email'))"
              :aria-describedby="inscription.erreur('email') ? 'erreur-email' : undefined"
              data-testid="champ-email"
            />
            <ErreurChamp
              id="erreur-email"
              :message="inscription.erreur('email')"
            />
          </label>
          <p class="text-sm text-ink-subtle">
            {{ $t('public.inscription.un_lien_de_confirmation') }}
          </p>

          <label
            class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
            for="code"
          >
            {{ $t('public.inscription.code_d_acces') }}
            <InputText
              id="code"
              v-model="code"
              type="password"
              inputmode="numeric"
              autocomplete="new-password"
              maxlength="4"
              class="text-center text-2xl tracking-[0.5em]"
              :aria-invalid="Boolean(inscription.erreur('code'))"
              :aria-describedby="inscription.erreur('code') ? 'erreur-code' : undefined"
              data-testid="champ-code"
              @blur="verifierCode"
            />
            <ErreurChamp
              id="erreur-code"
              :message="inscription.erreur('code')"
            />
          </label>

          <label
            class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
            for="confirmation"
          >
            {{ $t('public.inscription.confirme_le_code') }}
            <InputText
              id="confirmation"
              v-model="confirmation"
              type="password"
              inputmode="numeric"
              autocomplete="new-password"
              maxlength="4"
              class="text-center text-2xl tracking-[0.5em]"
              :aria-invalid="codesDifferents"
              :aria-describedby="codesDifferents ? 'erreur-confirmation' : undefined"
              data-testid="champ-confirmation"
            />
            <ErreurChamp
              id="erreur-confirmation"
              :message="codesDifferents ? $t('public.inscription.les_deux_codes_different') : undefined"
            />
          </label>
          <p class="text-sm text-ink-subtle">
            {{ $t('public.inscription.evite_les_suites') }}
          </p>

          <p
            v-if="erreur"
            role="alert"
            class="flex items-start gap-2 rounded-control bg-disputed-surface p-3 text-sm text-disputed-ink"
            data-testid="erreur-inscription"
          >
            <Icon
              name="lucide:octagon-alert"
              size="1rem"
              class="mt-0.5 shrink-0"
              aria-hidden="true"
            />
            {{ erreur }}
          </p>

          <div class="mt-auto flex flex-col gap-3 pt-4">
            <Button
              type="submit"
              :label="enCours ? $t('commun.envoi_en_cours') : $t('public.inscription.creer_mon_compte')"
              :disabled="!pret || enCours"
              class="w-full bg-brand text-brand-ink hover:bg-brand-strong"
              data-testid="bouton-inscription"
            />
            <!-- Le compte se crée ici : c'est ici qu'on accepte les
                 conditions, et elles doivent être lisibles avant. -->
            <p class="text-center text-xs text-ink-subtle">
              {{ $t('public.inscription.en_continuant_tu_acceptes') }}
              <NuxtLink
                to="/legal/cgu"
                class="text-brand underline underline-offset-4"
                data-testid="lien-cgu-inscription"
              >{{ $t('public.inscription.conditions_d_utilisation') }}</NuxtLink>
              {{ $t('public.inscription.et_la') }}
              <NuxtLink
                to="/legal/confidentialite"
                class="text-brand underline underline-offset-4"
              >{{ $t('public.inscription.politique_de_confidentialite') }}</NuxtLink>.
            </p>
            <p class="text-center text-sm text-ink-muted">
              {{ $t('public.inscription.deja_un_compte') }}
              <NuxtLink
                to="/login"
                class="font-semibold text-brand underline underline-offset-4"
                data-testid="lien-connexion"
              >{{ $t('public.inscription.se_connecter') }}</NuxtLink>
            </p>
          </div>
        </form>
      </template>
    </main>
  </div>
</template>

<!--
  États d'écran (règle 14) :
  · chargement — indiqué dans le libellé du bouton (« Envoi… »)
  · vide       — sans objet : un formulaire n'est jamais vide
  · erreur     — message en ligne avec `role="alert"`, sous le champ fautif
  · hors-ligne — <OfflineBanner> en tête de page
  · contenu    — le formulaire, puis l'écran « vérifie ta boîte mail »
-->
