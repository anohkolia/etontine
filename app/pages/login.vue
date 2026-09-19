<script setup lang="ts">
/**
 * Connexion par code à usage unique.
 *
 * Deux étapes sur une seule page : le numéro, puis le code. Pas de navigation
 * entre les deux — un membre qui perd la page perd son code.
 */
import { otpRequestInput } from '#shared/schemas'

definePageMeta({ layout: false })
const { t } = useI18n()

const { format, extraire, estComplet } = usePhoneMask()

/**
 * Le numéro est validé par `otpRequestInput`, le schéma du serveur : un numéro
 * ivoirien commence par 01, 05 ou 07. La règle s'affiche sous le champ à la
 * perte de focus, avant l'envoi — et le numéro part normalisé en E.164.
 */
const connexion = useFormulaire(otpRequestInput, { phone: '' })

const etape = ref<'numero' | 'code'>('numero')
const saisieNumero = ref('')
const code = ref('')
const enCours = ref(false)
const erreur = ref<string | null>(null)
const secondesAvantRenvoi = ref(0)
const echecs = ref(0)
const codeDeDeveloppement = ref<string | null>(null)

const numeroAffiche = computed(() => format(saisieNumero.value))

/**
 * Le masque est appliqué à la main plutôt que par un `v-model` calculé.
 *
 * Avec un `computed` en écriture, taper « 07.07 » puis « 07 07 » donne la même
 * valeur normalisée : le modèle ne change pas, Vue ne repeint pas le champ, et
 * la saisie brute reste affichée telle quelle. Le masque « saute » de façon
 * imprévisible. En reposant nous-mêmes la valeur de l'élément, l'affichage
 * suit toujours.
 */
function onSaisieNumero(evenement: Event) {
  const champ = evenement.target as HTMLInputElement
  saisieNumero.value = extraire(champ.value)
  champ.value = format(saisieNumero.value)
  connexion.setFieldValue('phone', saisieNumero.value, false)
}

/** À la perte de focus seulement : signaler l'erreur à la première frappe serait harceler. */
async function verifierNumero() {
  if (saisieNumero.value.length > 0) await connexion.valider()
}

const numeroValide = computed(() => estComplet(saisieNumero.value))
/** L'appel vocal n'est proposé qu'après deux essais infructueux. */
const vocalDisponible = computed(() => echecs.value >= 2)

let minuterie: ReturnType<typeof setInterval> | undefined

function lancerCompteARebours(secondes: number) {
  secondesAvantRenvoi.value = secondes
  clearInterval(minuterie)
  minuterie = setInterval(() => {
    secondesAvantRenvoi.value--
    if (secondesAvantRenvoi.value <= 0) clearInterval(minuterie)
  }, 1000)
}

onBeforeUnmount(() => clearInterval(minuterie))

function messageErreur(e: unknown): string {
  const data = (e as { data?: { error?: { message?: string } } })?.data
  return data?.error?.message ?? t('commun.serveur_injoignable_connexion')
}

async function demanderCode(canal: 'sms' | 'voice' = 'sms') {
  erreur.value = null
  const valeurs = await connexion.valider()
  if (!valeurs) return
  enCours.value = true
  try {
    const reponse = await $fetch<{ resendAfterSeconds: number, devCode?: string }>(
      canal === 'sms' ? '/api/v1/auth/otp/request' : '/api/v1/auth/otp/voice',
      { method: 'POST', body: { phone: valeurs.phone } },
    )
    etape.value = 'code'
    codeDeDeveloppement.value = reponse.devCode ?? null
    lancerCompteARebours(reponse.resendAfterSeconds)
  }
  catch (e) {
    erreur.value = messageErreur(e)
  }
  finally {
    enCours.value = false
  }
}

async function verifier() {
  erreur.value = null
  enCours.value = true
  try {
    const { isNewUser } = await $fetch<{ isNewUser: boolean }>('/api/v1/auth/otp/verify', {
      method: 'POST',
      body: { phone: saisieNumero.value, code: code.value },
    })
    await useSessionStore().charger(true)
    // Un code SMS prouve plus qu'un code d'écran : l'onglet est déverrouillé,
    // et c'est aussi la sortie de secours de « code oublié ».
    useVerrou().deverrouiller()
    await navigateTo(destination(isNewUser))
  }
  catch (e) {
    echecs.value++
    code.value = ''
    erreur.value = messageErreur(e)
  }
  finally {
    enCours.value = false
  }
}

/**
 * Où aller après la connexion.
 *
 * Le middleware d'authentification range l'intention initiale dans
 * `?redirect=` : quelqu'un qui ouvre un lien de cotisation reçu par WhatsApp
 * doit retomber sur cette cotisation, pas sur un tableau de bord générique.
 *
 * La destination n'est acceptée que si elle est **interne** : un `redirect=`
 * pointant vers un autre domaine transformerait l'écran de connexion en
 * tremplin d'hameçonnage.
 */
function destination(nouveauCompte: boolean): string {
  const demandee = useRoute().query.redirect
  if (typeof demandee === 'string' && /^\/(?!\/)/.test(demandee)) return demandee
  return nouveauCompte ? '/app/profil' : '/app'
}

/**
 * Quelqu'un de déjà connecté n'a rien à faire ici : on le renvoie dans
 * l'application, ou vers l'intention qu'il portait.
 */
const sessionExpiree = computed(() => useRoute().query.motif === 'expiree')

onMounted(async () => {
  const session = useSessionStore()
  await session.charger()
  if (session.connecte) await navigateTo(destination(false), { replace: true })
})

function changerDeNumero() {
  etape.value = 'numero'
  code.value = ''
  erreur.value = null
  echecs.value = 0
  clearInterval(minuterie)
}

useHead({ title: t('public.login.connexion_etontine') })
</script>

<template>
  <div class="flex min-h-dvh flex-col bg-surface">
    <!-- un code par SMS ne se demande pas hors réseau : rien n'est mis en file
         ici, et promettre le contraire ferait attendre un envoi qui n'a pas eu
         lieu. -->
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

      <!-- Deux segments pour deux étapes, repris du template : le membre voit
           où il en est sans avoir à lire. -->
      <ol
        class="flex items-center gap-2"
        aria-hidden="true"
      >
        <li class="h-1.5 flex-1 rounded-full bg-brand" />
        <li
          class="h-1.5 flex-1 rounded-full transition-colors"
          :class="etape === 'code' ? 'bg-brand' : 'bg-surface-sunken'"
        />
      </ol>

      <p
        v-if="sessionExpiree && etape === 'numero'"
        role="status"
        class="flex items-start gap-2 rounded-control bg-late-surface p-3 text-sm text-late-ink"
        data-testid="session-expiree"
      >
        <Icon
          name="lucide:clock"
          size="1rem"
          class="mt-0.5 shrink-0"
          aria-hidden="true"
        />
        {{ $t('public.login.ta_session_a_expire') }}
      </p>

      <header class="flex flex-col gap-2">
        <h1 class="text-2xl font-bold text-ink">
          {{ etape === 'numero' ? $t('public.login.ton_numero_c_est') : $t('public.login.ton_code') }}
        </h1>
        <p class="text-ink-muted">
          <template v-if="etape === 'numero'">
            {{ $t('public.login.on_t_envoie_un') }}
          </template>
          <template v-else>
            {{ $t('public.login.code_envoye_au') }} <span class="font-medium text-ink">{{ numeroAffiche }}</span>.
          </template>
        </p>
      </header>

      <!-- Étape 1 : le numéro -->
      <form
        v-if="etape === 'numero'"
        class="flex flex-1 flex-col gap-4"
        @submit.prevent="demanderCode('sms')"
      >
        <label
          class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
          for="telephone"
        >
          {{ $t('public.login.numero_de_telephone') }}
          <!-- L'indicatif est affiché, pas saisi : le membre tape son numéro
               comme il le donne à l'oral, et voit que le pays est le bon. -->
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
              :aria-invalid="Boolean(connexion.erreur('phone'))"
              :aria-describedby="erreur ? 'erreur-login' : connexion.erreur('phone') ? 'erreur-telephone' : undefined"
              class="text-lg tracking-wider tabular-nums"
              data-testid="champ-telephone"
              @input="onSaisieNumero"
              @blur="verifierNumero"
            />
          </span>
          <ErreurChamp
            id="erreur-telephone"
            :message="connexion.erreur('phone')"
          />
        </label>
        <p class="text-sm text-ink-subtle">
          {{ $t('public.login.un_numero_ivoirien_01') }}
        </p>

        <p
          v-if="erreur"
          id="erreur-login"
          role="alert"
          class="flex items-start gap-2 rounded-control bg-disputed-surface p-3 text-sm text-disputed-ink"
          data-testid="erreur-login"
        >
          <Icon
            name="lucide:octagon-alert"
            size="1rem"
            class="mt-0.5 shrink-0"
            aria-hidden="true"
          />
          {{ erreur }}
        </p>

        <!-- Règle 13 : l'action primaire est en bas d'écran, à portée de pouce. -->
        <div class="mt-auto flex flex-col gap-3 pt-4">
          <Button
            type="submit"
            :label="enCours ? $t('commun.envoi_en_cours') : $t('commun.recevoir_le_code')"
            :disabled="!numeroValide || enCours"
            class="w-full bg-brand text-brand-ink hover:bg-brand-strong"
            data-testid="bouton-recevoir-code"
          />
          <!-- Le compte se crée à la validation du code : c'est ici qu'on
               accepte les conditions, et elles doivent être lisibles avant. -->
          <p class="text-center text-xs text-ink-subtle">
            {{ $t('public.login.en_continuant_tu_acceptes') }}
            <NuxtLink
              to="/legal/cgu"
              class="text-brand underline underline-offset-4"
              data-testid="lien-cgu-login"
            >{{ $t('public.login.conditions_d_utilisation') }}</NuxtLink>
            {{ $t('public.login.et_la') }}
            <NuxtLink
              to="/legal/confidentialite"
              class="text-brand underline underline-offset-4"
            >{{ $t('public.login.politique_de_confidentialite') }}</NuxtLink>.
          </p>
        </div>
      </form>

      <!-- Étape 2 : le code -->
      <form
        v-else
        class="flex flex-1 flex-col gap-4"
        @submit.prevent="verifier"
      >
        <!-- `one-time-code` permet à Android et iOS de proposer le code reçu
             sans que le membre ait à quitter l'application pour le recopier. -->
        <InputOtp
          v-model="code"
          :length="6"
          integer-only
          data-testid="champ-code"
          @update:model-value="erreur = null"
        />

        <p
          v-if="codeDeDeveloppement"
          class="rounded-control bg-late-surface p-2 text-sm text-late-ink"
          data-testid="code-dev"
        >
          {{ $t('public.login.developpement_code') }} <strong>{{ codeDeDeveloppement }}</strong>
        </p>

        <p
          v-if="erreur"
          role="alert"
          class="flex items-start gap-2 rounded-control bg-disputed-surface p-3 text-sm text-disputed-ink"
          data-testid="erreur-login"
        >
          <Icon
            name="lucide:octagon-alert"
            size="1rem"
            class="mt-0.5 shrink-0"
            aria-hidden="true"
          />
          {{ erreur }}
        </p>

        <div class="flex flex-col gap-2 text-sm">
          <button
            type="button"
            class="min-h-touch text-left text-brand underline underline-offset-4 disabled:text-ink-subtle disabled:no-underline"
            :disabled="secondesAvantRenvoi > 0 || enCours"
            data-testid="bouton-renvoyer"
            @click="demanderCode('sms')"
          >
            {{ secondesAvantRenvoi > 0
              ? $t('public.login.renvoyer_le_code_dans', { s: secondesAvantRenvoi })
              : $t('commun.renvoyer_le_code') }}
          </button>

          <button
            v-if="vocalDisponible"
            type="button"
            class="min-h-touch text-left text-brand underline underline-offset-4"
            data-testid="bouton-vocal"
            @click="demanderCode('voice')"
          >
            {{ $t('public.login.recevoir_le_code_par') }}
          </button>

          <button
            type="button"
            class="min-h-touch text-left text-ink-muted underline underline-offset-4"
            data-testid="bouton-changer-numero"
            @click="changerDeNumero"
          >
            {{ $t('public.login.changer_de_numero') }}
          </button>
        </div>

        <div class="mt-auto pt-4">
          <Button
            type="submit"
            :label="enCours ? $t('commun.verification_en_cours') : $t('public.login.valider')"
            :disabled="code.length !== 6 || enCours"
            class="w-full bg-brand text-brand-ink hover:bg-brand-strong"
            data-testid="bouton-valider-code"
          />
        </div>
      </form>
    </main>
  </div>
</template>

<!--
  États d'écran (règle 14) :
  · chargement — indiqué dans les libellés des boutons (« Envoi… », « Vérification… »)
  · vide       — sans objet : un formulaire n'est jamais vide
  · erreur     — message en ligne avec `role="alert"`, à côté du champ fautif
  · hors-ligne — <OfflineBanner> en tête de page
  · contenu    — le formulaire, en deux étapes
-->
