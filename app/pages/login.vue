<script setup lang="ts">
/**
 * Connexion par numéro et code d'accès.
 *
 * Une seule étape : le numéro et les quatre chiffres. Plus de SMS — le code
 * a été choisi à l'inscription, confirmée par e-mail. « Code oublié ? » mène
 * à la réinitialisation par lien.
 */
import { loginInput } from '#shared/schemas'

definePageMeta({ layout: false })
const { t } = useI18n()

const { format, extraire, estComplet } = usePhoneMask()

/**
 * Le numéro est validé par `loginInput`, le schéma du serveur : un numéro
 * ivoirien commence par 01, 05 ou 07. La règle s'affiche sous le champ à la
 * perte de focus, avant l'envoi — et le numéro part normalisé en E.164.
 */
const connexion = useFormulaire(loginInput, { phone: '', code: '' })

const saisieNumero = ref('')
const code = ref('')
const enCours = ref(false)
const erreur = ref<string | null>(null)

const numeroAffiche = computed(() => format(saisieNumero.value))

/**
 * Le masque est appliqué à la main plutôt que par un `v-model` calculé.
 *
 * Avec un `computed` en écriture, taper « 07.07 » puis « 07 07 » donne la même
 * valeur normalisée : le modèle ne change pas, Vue ne repeint pas le champ, et
 * la saisie brute reste affichée telle quelle. En reposant nous-mêmes la
 * valeur de l'élément, l'affichage suit toujours.
 */
function onSaisieNumero(evenement: Event) {
  const champ = evenement.target as HTMLInputElement
  saisieNumero.value = extraire(champ.value)
  champ.value = format(saisieNumero.value)
  connexion.setFieldValue('phone', saisieNumero.value, false)
}

/** À la perte de focus seulement : signaler l'erreur à la première frappe serait harceler. */
async function verifierNumero() {
  if (saisieNumero.value.length > 0) await connexion.validerChamp('phone')
}

const pret = computed(() => estComplet(saisieNumero.value) && /^\d{4}$/.test(code.value))

function messageErreur(e: unknown): string {
  const data = (e as { data?: { error?: { message?: string } } })?.data
  return data?.error?.message ?? t('commun.serveur_injoignable_connexion')
}

async function seConnecter() {
  erreur.value = null
  connexion.setFieldValue('code', code.value, false)
  const valeurs = await connexion.valider()
  if (!valeurs) return
  enCours.value = true
  try {
    await $fetch('/api/v1/auth/login', { method: 'POST', body: valeurs })
    await useSessionStore().charger(true)
    // Le code vient d'être saisi : l'écran de verrouillage n'a pas à le redemander.
    useVerrou().deverrouiller()
    await navigateTo(destination())
  }
  catch (e) {
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
function destination(): string {
  const demandee = useRoute().query.redirect
  if (typeof demandee === 'string' && /^\/(?!\/)/.test(demandee)) return demandee
  return '/app'
}

/** Le lien vers l'inscription garde l'intention : rejoindre une tontine, puis s'inscrire, puis y arriver. */
const lienInscription = computed(() => {
  const demandee = useRoute().query.redirect
  return typeof demandee === 'string' ? { path: '/inscription', query: { redirect: demandee } } : '/inscription'
})

/**
 * Quelqu'un de déjà connecté n'a rien à faire ici : on le renvoie dans
 * l'application, ou vers l'intention qu'il portait.
 */
const sessionExpiree = computed(() => useRoute().query.motif === 'expiree')

onMounted(async () => {
  const session = useSessionStore()
  await session.charger()
  if (session.connecte) await navigateTo(destination(), { replace: true })
})

useHead({ title: t('public.login.connexion_etontine') })
</script>

<template>
  <div class="flex min-h-dvh flex-col bg-surface">
    <!-- La connexion se vérifie côté serveur : rien n'est mis en file ici, et
         promettre le contraire ferait attendre une ouverture qui n'a pas eu lieu. -->
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

      <p
        v-if="sessionExpiree"
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
          {{ $t('public.login.titre') }}
        </h1>
        <p class="text-ink-muted">
          {{ $t('public.login.ton_numero_et_ton_code') }}
        </p>
      </header>

      <form
        class="flex flex-1 flex-col gap-4"
        @submit.prevent="seConnecter"
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

        <label
          class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
          for="code"
        >
          {{ $t('public.login.code_d_acces') }}
          <!-- `current-password` : le gestionnaire de mots de passe du
               téléphone propose le code, comme pour n'importe quel compte. -->
          <InputText
            id="code"
            v-model="code"
            type="password"
            inputmode="numeric"
            autocomplete="current-password"
            maxlength="4"
            class="text-center text-2xl tracking-[0.5em]"
            :aria-describedby="erreur ? 'erreur-login' : undefined"
            data-testid="champ-code"
            @input="erreur = null"
          />
        </label>

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

        <NuxtLink
          to="/code-oublie"
          class="min-h-touch inline-flex items-center self-start text-sm text-brand underline underline-offset-4"
          data-testid="lien-code-oublie"
        >
          {{ $t('public.login.code_oublie') }}
        </NuxtLink>

        <!-- Règle 13 : l'action primaire est en bas d'écran, à portée de pouce. -->
        <div class="mt-auto flex flex-col gap-3 pt-4">
          <Button
            type="submit"
            :label="enCours ? $t('commun.verification_en_cours') : $t('public.login.se_connecter')"
            :disabled="!pret || enCours"
            class="w-full bg-brand text-brand-ink hover:bg-brand-strong"
            data-testid="bouton-connexion"
          />
          <p class="text-center text-sm text-ink-muted">
            {{ $t('public.login.pas_encore_de_compte') }}
            <NuxtLink
              :to="lienInscription"
              class="font-semibold text-brand underline underline-offset-4"
              data-testid="lien-inscription"
            >{{ $t('public.login.creer_un_compte') }}</NuxtLink>
          </p>
        </div>
      </form>
    </main>
  </div>
</template>

<!--
  États d'écran (règle 14) :
  · chargement — indiqué dans le libellé du bouton (« Vérification… »)
  · vide       — sans objet : un formulaire n'est jamais vide
  · erreur     — message en ligne avec `role="alert"`, à côté du champ fautif
  · hors-ligne — <OfflineBanner> en tête de page
  · contenu    — le formulaire
-->
