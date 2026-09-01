<script setup lang="ts">
/**
 * Connexion par code à usage unique.
 *
 * Deux étapes sur une seule page : le numéro, puis le code. Pas de navigation
 * entre les deux — un membre qui perd la page perd son code.
 */
definePageMeta({ layout: false })

const { format, extraire, estComplet } = usePhoneMask()

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
  return data?.error?.message ?? 'Impossible de joindre le serveur. Vérifie ta connexion.'
}

async function demanderCode(canal: 'sms' | 'voice' = 'sms') {
  erreur.value = null
  enCours.value = true
  try {
    const reponse = await $fetch<{ resendAfterSeconds: number, devCode?: string }>(
      canal === 'sms' ? '/api/v1/auth/otp/request' : '/api/v1/auth/otp/voice',
      { method: 'POST', body: { phone: saisieNumero.value } },
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

function changerDeNumero() {
  etape.value = 'numero'
  code.value = ''
  erreur.value = null
  echecs.value = 0
  clearInterval(minuterie)
}

useHead({ title: 'Connexion — eTontine' })
</script>

<template>
  <div class="flex min-h-dvh flex-col bg-surface">
    <OfflineBanner />

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
        Retour à l’accueil
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

      <header class="flex flex-col gap-2">
        <h1 class="text-2xl font-bold text-ink">
          {{ etape === 'numero' ? 'Ton numéro, c’est tout' : 'Ton code' }}
        </h1>
        <p class="text-ink-muted">
          <template v-if="etape === 'numero'">
            On t’envoie un code à six chiffres par SMS. Pas de mot de passe à
            retenir.
          </template>
          <template v-else>
            Code envoyé au <span class="font-medium text-ink">{{ numeroAffiche }}</span>.
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
          Numéro de téléphone
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
              :aria-describedby="erreur ? 'erreur-login' : undefined"
              class="text-lg tracking-wider tabular-nums"
              data-testid="champ-telephone"
              @input="onSaisieNumero"
            />
          </span>
        </label>
        <p class="text-sm text-ink-subtle">
          Un numéro ivoirien : 01, 05 ou 07.
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
        <div class="mt-auto pt-4">
          <Button
            type="submit"
            :label="enCours ? 'Envoi…' : 'Recevoir le code'"
            :disabled="!numeroValide || enCours"
            class="w-full bg-brand text-brand-ink hover:bg-brand-strong"
            data-testid="bouton-recevoir-code"
          />
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
          Développement — code : <strong>{{ codeDeDeveloppement }}</strong>
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
              ? `Renvoyer le code dans ${secondesAvantRenvoi} s`
              : 'Renvoyer le code' }}
          </button>

          <button
            v-if="vocalDisponible"
            type="button"
            class="min-h-touch text-left text-brand underline underline-offset-4"
            data-testid="bouton-vocal"
            @click="demanderCode('voice')"
          >
            Recevoir le code par appel
          </button>

          <button
            type="button"
            class="min-h-touch text-left text-ink-muted underline underline-offset-4"
            data-testid="bouton-changer-numero"
            @click="changerDeNumero"
          >
            Changer de numéro
          </button>
        </div>

        <div class="mt-auto pt-4">
          <Button
            type="submit"
            :label="enCours ? 'Vérification…' : 'Valider'"
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
