<script setup lang="ts">
/**
 * Profil : identité, verrouillage, consentements.
 *
 * Les consentements sont **deux cases distinctes** (acceptation T08) :
 * accepter le traitement de ses données pour faire tourner sa tontine n'est
 * pas accepter de recevoir des notifications. Les fusionner reviendrait à
 * extorquer le second en échange du premier.
 */
import { profileInput } from '#shared/schemas'

definePageMeta({ layout: 'app', middleware: 'auth' })
const { t } = useI18n()

const session = useSessionStore()
const route = useRoute()

/**
 * Le nom, validé par le schéma que le serveur applique (`profileInput`) :
 * deux lettres au moins, cinquante au plus, et l'erreur sous le champ avant
 * l'envoi plutôt qu'un `422` en bas d'écran après.
 */
const identite = useFormulaire(profileInput, {
  firstName: session.user?.firstName ?? '',
  lastName: session.user?.lastName ?? '',
})
const [prenom, prenomAttrs] = identite.champ('firstName')
const [nom, nomAttrs] = identite.champ('lastName')
const enregistrement = ref(false)
const messageProfil = ref<string | null>(null)
const erreur = ref<string | null>(null)

const etat = ref<'chargement' | 'contenu' | 'erreur'>('chargement')
const consentements = ref({ data: false, notifications: false })
const pin = ref('')
const pinActuel = ref('')
const messagePin = ref<string | null>(null)

/** Le palier réclamé par la page dont on vient, s'il y en a une. */
const palierDemande = computed(() => Number(route.query.palier ?? 0))

function message(e: unknown): string {
  return (e as { data?: { error?: { message?: string } } })?.data?.error?.message
    ?? t('commun.serveur_injoignable')
}

async function charger() {
  etat.value = 'chargement'
  try {
    const donnees = await $fetch<{
      profil: { consentDataAt: string | null, consentNotificationsAt: string | null }
    }>('/api/v1/me/export')

    consentements.value = {
      data: donnees.profil.consentDataAt !== null,
      notifications: donnees.profil.consentNotificationsAt !== null,
    }
    etat.value = 'contenu'
  }
  catch (e) {
    erreur.value = message(e)
    etat.value = 'erreur'
  }
}

onMounted(charger)

async function enregistrerProfil() {
  erreur.value = null
  messageProfil.value = null
  const valeurs = await identite.valider()
  if (!valeurs) return
  enregistrement.value = true
  try {
    await $fetch('/api/v1/me', {
      method: 'PATCH',
      body: { firstName: valeurs.firstName, lastName: valeurs.lastName },
    })
    await session.charger(true)
    messageProfil.value = t('profil.index.profil_enregistre')

    const redirection = route.query.redirect
    if (typeof redirection === 'string' && (session.user?.kycLevel ?? 0) >= palierDemande.value) {
      await navigateTo(redirection)
    }
  }
  catch (e) {
    erreur.value = message(e)
  }
  finally {
    enregistrement.value = false
  }
}

async function basculerConsentement(clef: 'data' | 'notifications', valeur: boolean) {
  consentements.value[clef] = valeur
  await $fetch('/api/v1/me/consents', { method: 'PATCH', body: { [clef]: valeur } })
}

/**
 * Changement de numéro, contre le code d'accès.
 *
 * Le numéro est l'identifiant de connexion et l'adresse du pot : la session
 * seule ne suffit pas. Après le changement, les versements vers ce membre
 * sont gelés quarante-huit heures et son bureau est prévenu.
 */
const { format: formatTel, extraire, estComplet } = usePhoneMask()
const changementOuvert = ref(false)
const nouveauNumero = ref('')
const codeNumero = ref('')
const numeroEnCours = ref(false)
const messageNumero = ref<string | null>(null)
const erreurNumero = ref(false)

const nouveauNumeroAffiche = computed(() => formatTel(nouveauNumero.value))
const nouveauNumeroValide = computed(() => estComplet(nouveauNumero.value) && /^\d{4}$/.test(codeNumero.value))

function onSaisieNouveauNumero(evenement: Event) {
  const champ = evenement.target as HTMLInputElement
  nouveauNumero.value = extraire(champ.value)
  champ.value = formatTel(nouveauNumero.value)
}

async function validerNumero() {
  messageNumero.value = null
  erreurNumero.value = false
  numeroEnCours.value = true
  try {
    await $fetch('/api/v1/me/phone', {
      method: 'POST',
      body: { phone: nouveauNumero.value, code: codeNumero.value },
    })
    await session.charger(true)
    changementOuvert.value = false
    nouveauNumero.value = ''
    codeNumero.value = ''
    messageProfil.value = t('profil.index.numero_change_les_versements')
  }
  catch (e) {
    messageNumero.value = message(e)
    erreurNumero.value = true
    codeNumero.value = ''
  }
  finally {
    numeroEnCours.value = false
  }
}

/**
 * Changement d'adresse : le code, puis un lien sur la nouvelle adresse. Elle
 * ne remplace l'ancienne qu'une fois le lien ouvert.
 */
const emailOuvert = ref(false)
const nouvelEmail = ref('')
const codeEmail = ref('')
const emailEnCours = ref(false)
const messageEmail = ref<string | null>(null)
const erreurEmail = ref(false)
const lienDevEmail = ref<string | null>(null)

const emailValide = computed(() => nouvelEmail.value.includes('@') && /^\d{4}$/.test(codeEmail.value))

async function changerEmail() {
  messageEmail.value = null
  erreurEmail.value = false
  lienDevEmail.value = null
  emailEnCours.value = true
  try {
    const reponse = await $fetch<{ devToken?: string }>('/api/v1/me/email', {
      method: 'POST',
      body: { email: nouvelEmail.value, code: codeEmail.value },
    })
    lienDevEmail.value = reponse.devToken ? `/confirmer?token=${reponse.devToken}` : null
    codeEmail.value = ''
    messageEmail.value = t('profil.index.lien_envoye')
  }
  catch (e) {
    messageEmail.value = message(e)
    erreurEmail.value = true
    codeEmail.value = ''
  }
  finally {
    emailEnCours.value = false
  }
}

/** Changement du code d'accès : le code courant est exigé, toujours. */
async function changerPin() {
  messagePin.value = null
  try {
    await $fetch('/api/v1/auth/pin', {
      method: 'POST',
      body: { code: pin.value, currentCode: pinActuel.value },
    })
    pin.value = ''
    pinActuel.value = ''
    messagePin.value = t('profil.index.code_de_verrouillage_enregistre')
  }
  catch (e) {
    messagePin.value = message(e)
  }
}

useEnTete(() => ({
  titre: t('commun.mon_profil'),
  sousTitre: session.user?.phone ?? undefined,
}))
useHead({ title: t('profil.index.mon_profil_etontine') })
</script>

<template>
  <div class="flex flex-col gap-6">
    <LoadingSkeleton
      v-if="etat === 'chargement'"
      variant="card"
      :count="2"
    />

    <ErrorState
      v-else-if="etat === 'erreur'"
      :detail="erreur ?? undefined"
      @retry="charger"
    />

    <template v-else>
      <p
        v-if="palierDemande > 0"
        class="flex items-start gap-2 rounded-control bg-declared-surface p-3 text-sm text-declared-ink"
        data-testid="palier-manquant"
      >
        <Icon
          name="lucide:circle-alert"
          size="1rem"
          class="mt-0.5 shrink-0"
          aria-hidden="true"
        />
        {{ $t('profil.index.renseigne_ton_nom_complet') }}
      </p>

      <!-- Carte d'identité, reprise de l'en-tête de profil du template.
           Le template y place un score de confiance sur 1000 et trois badges
           (« Payeur Or », « Doyen Tontinier ») : le §6 module 11 du cahier les
           supprime explicitement — une note chiffrée sur une personne qui
           épargne constitue un fichier de scoring sans cadre réglementaire, et
           les paliers « Débutant / Expert » y sont nommément écartés. La
           vérification d'identité prend leur place : c'est un fait, pas une
           note, et elle conditionne réellement ce que le membre peut faire. -->
      <section class="card-surface flex items-center gap-4 p-5">
        <AvatarInitiales
          :prenom="session.user?.firstName"
          :nom="session.user?.lastName"
          size="lg"
          solide
        />
        <div class="min-w-0">
          <h2 class="truncate text-lg font-bold text-ink">
            {{ [session.user?.firstName, session.user?.lastName].filter(Boolean).join(' ') || $t('profil.index.profil_a_completer') }}
          </h2>
          <p class="tabular truncate text-sm text-ink-muted">
            {{ session.user?.phone }}
          </p>
          <p class="mt-1.5">
            <NuxtLink
              v-if="(session.user?.kycLevel ?? 0) < 2"
              to="/app/profil/identite"
              class="inline-flex items-center gap-1.5 rounded-full bg-late-surface px-2.5 py-1 text-xs font-semibold text-late-ink"
              data-testid="etat-identite"
            >
              <Icon
                name="lucide:shield-alert"
                size="0.875rem"
                aria-hidden="true"
              />
              {{ $t('profil.index.identite_a_verifier') }}
            </NuxtLink>
            <span
              v-else
              class="inline-flex items-center gap-1.5 rounded-full bg-confirmed-surface px-2.5 py-1 text-xs font-semibold text-confirmed-ink"
              data-testid="etat-identite"
            >
              <Icon
                name="lucide:shield-check"
                size="0.875rem"
                aria-hidden="true"
              />
              {{ $t('profil.index.identite_verifiee') }}
            </span>
          </p>
        </div>
      </section>

      <!-- Identité -->
      <section class="card-surface flex flex-col gap-3 p-4">
        <h2 class="font-semibold text-ink">
          {{ $t('profil.index.identite_2') }}
        </h2>
        <p class="text-sm text-ink-muted">
          {{ $t('profil.index.ton_numero') }} <span
            class="font-medium text-ink"
            data-testid="numero-actuel"
          >{{ session.user?.phone }}</span>
          <button
            type="button"
            class="ml-2 min-h-touch text-sm text-brand underline underline-offset-4"
            data-testid="bouton-changer-numero"
            @click="changementOuvert = !changementOuvert"
          >
            {{ changementOuvert ? $t('commun.annuler') : $t('profil.index.changer') }}
          </button>
        </p>

        <!-- Changement de numéro : le code d'accès, puis un gel de
             quarante-huit heures sur les versements vers ce membre. Le numéro
             est l'identifiant du compte et l'adresse du pot — pas un champ
             de formulaire ordinaire. -->
        <form
          v-if="changementOuvert"
          class="flex flex-col gap-3 rounded-control bg-surface-muted p-3"
          data-testid="formulaire-numero"
          @submit.prevent="validerNumero"
        >
          <label
            class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
            for="nouveau-numero"
          >
            {{ $t('profil.index.nouveau_numero') }}
            <span class="flex items-stretch gap-2">
              <span class="flex min-h-touch shrink-0 items-center rounded-control border border-line bg-surface px-3 text-base font-semibold text-ink">
                +225
              </span>
              <InputText
                id="nouveau-numero"
                :value="nouveauNumeroAffiche"
                inputmode="tel"
                autocomplete="tel"
                placeholder="07 07 12 34 56"
                class="tabular-nums"
                data-testid="champ-nouveau-numero"
                @input="onSaisieNouveauNumero"
              />
            </span>
          </label>
          <label
            class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
            for="code-numero"
          >
            {{ $t('profil.index.ton_code_pour_confirmer') }}
            <InputText
              id="code-numero"
              v-model="codeNumero"
              type="password"
              inputmode="numeric"
              autocomplete="current-password"
              maxlength="4"
              class="tracking-[0.5em]"
              data-testid="champ-code-numero"
            />
          </label>
          <p class="text-sm text-ink-subtle">
            {{ $t('profil.index.le_numero_est_ton_identifiant') }}
          </p>

          <p
            v-if="messageNumero"
            :role="erreurNumero ? 'alert' : 'status'"
            class="text-sm"
            :class="erreurNumero ? 'text-disputed-ink' : 'text-confirmed-ink'"
            data-testid="message-numero"
          >
            {{ messageNumero }}
          </p>

          <Button
            type="submit"
            :label="numeroEnCours ? $t('commun.verification_en_cours') : $t('profil.index.valider_le_nouveau_numero')"
            :disabled="numeroEnCours || !nouveauNumeroValide"
            class="bg-brand text-brand-ink hover:bg-brand-strong"
            data-testid="bouton-valider-numero"
          />
        </form>

        <!-- Adresse e-mail : c'est elle qui rouvre le compte quand le code est
             oublié. Un lien sur la nouvelle adresse, l'ancienne prévenue. -->
        <p class="text-sm text-ink-muted">
          {{ $t('profil.index.ton_adresse') }} <span
            class="font-medium text-ink"
            data-testid="email-actuel"
          >{{ session.user?.email ?? '—' }}</span>
          <button
            type="button"
            class="ml-2 min-h-touch text-sm text-brand underline underline-offset-4"
            data-testid="bouton-changer-email"
            @click="emailOuvert = !emailOuvert"
          >
            {{ emailOuvert ? $t('commun.annuler') : $t('profil.index.changer') }}
          </button>
        </p>

        <form
          v-if="emailOuvert"
          class="flex flex-col gap-3 rounded-control bg-surface-muted p-3"
          data-testid="formulaire-email"
          @submit.prevent="changerEmail"
        >
          <label
            class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
            for="nouvel-email"
          >
            {{ $t('profil.index.nouvelle_adresse') }}
            <InputText
              id="nouvel-email"
              v-model="nouvelEmail"
              type="email"
              inputmode="email"
              autocomplete="email"
              data-testid="champ-nouvel-email"
            />
          </label>
          <label
            class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
            for="code-email"
          >
            {{ $t('profil.index.ton_code_pour_confirmer') }}
            <InputText
              id="code-email"
              v-model="codeEmail"
              type="password"
              inputmode="numeric"
              autocomplete="current-password"
              maxlength="4"
              class="tracking-[0.5em]"
              data-testid="champ-code-email"
            />
          </label>
          <p class="text-sm text-ink-subtle">
            {{ $t('profil.index.un_lien_partira') }}
          </p>

          <p
            v-if="messageEmail"
            :role="erreurEmail ? 'alert' : 'status'"
            class="text-sm"
            :class="erreurEmail ? 'text-disputed-ink' : 'text-confirmed-ink'"
            data-testid="message-email"
          >
            {{ messageEmail }}
          </p>
          <p
            v-if="lienDevEmail"
            class="rounded-control bg-late-surface p-2 text-sm text-late-ink"
            data-testid="lien-dev-email"
          >
            {{ $t('profil.index.developpement_lien') }}
            <NuxtLink
              :to="lienDevEmail"
              class="font-semibold break-all underline underline-offset-4"
              data-testid="lien-dev-email-confirmer"
            >{{ lienDevEmail }}</NuxtLink>
          </p>

          <Button
            type="submit"
            :label="emailEnCours ? $t('commun.envoi_en_cours') : $t('profil.index.envoyer_le_lien')"
            :disabled="emailEnCours || !emailValide"
            class="bg-brand text-brand-ink hover:bg-brand-strong"
            data-testid="bouton-valider-email"
          />
        </form>

        <form
          class="flex flex-col gap-3"
          @submit.prevent="enregistrerProfil"
        >
          <label
            class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
            for="prenom"
          >
            {{ $t('profil.index.prenom') }}
            <InputText
              id="prenom"
              v-model="prenom"
              v-bind="prenomAttrs"
              autocomplete="given-name"
              :aria-invalid="Boolean(identite.erreur('firstName'))"
              :aria-describedby="identite.erreur('firstName') ? 'erreur-prenom' : undefined"
              data-testid="champ-prenom"
            />
            <ErreurChamp
              id="erreur-prenom"
              :message="identite.erreur('firstName')"
            />
          </label>
          <label
            class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
            for="nom"
          >
            {{ $t('profil.index.nom') }}
            <InputText
              id="nom"
              v-model="nom"
              v-bind="nomAttrs"
              autocomplete="family-name"
              :aria-invalid="Boolean(identite.erreur('lastName'))"
              :aria-describedby="identite.erreur('lastName') ? 'erreur-nom' : undefined"
              data-testid="champ-nom"
            />
            <ErreurChamp
              id="erreur-nom"
              :message="identite.erreur('lastName')"
            />
          </label>

          <p
            v-if="erreur"
            role="alert"
            class="text-sm text-disputed-ink"
          >
            {{ erreur }}
          </p>
          <p
            v-if="messageProfil"
            role="status"
            class="text-sm text-confirmed-ink"
            data-testid="profil-enregistre"
          >
            {{ messageProfil }}
          </p>

          <Button
            type="submit"
            :label="enregistrement ? $t('profil.index.enregistrement') : $t('profil.index.enregistrer')"
            :disabled="enregistrement"
            class="bg-brand text-brand-ink hover:bg-brand-strong"
            data-testid="bouton-enregistrer-profil"
          />
        </form>
      </section>

      <!-- Consentements : deux cases séparées, jamais une seule -->
      <section class="card-surface flex flex-col gap-3 p-4">
        <h2 class="font-semibold text-ink">
          {{ $t('profil.index.mes_choix') }}
        </h2>

        <label class="flex min-h-touch items-start gap-3 text-sm">
          <input
            type="checkbox"
            class="mt-1 size-5 shrink-0 accent-brand"
            :checked="consentements.data"
            data-testid="consentement-donnees"
            @change="basculerConsentement('data', ($event.target as HTMLInputElement).checked)"
          >
          <span>
            <span class="font-medium text-ink">{{ $t('profil.index.traitement_de_mes_donnees') }}</span>
            <span class="block text-ink-muted">
              {{ $t('profil.index.necessaire_pour_tenir_le') }}
              <!-- On consent à quelque chose qu'on peut lire : sans le lien,
                   la case demandait la confiance, pas le consentement. -->
              <NuxtLink
                to="/legal/confidentialite"
                class="text-brand underline underline-offset-4"
                data-testid="lien-politique-confidentialite"
              >
                {{ $t('profil.index.ce_que_l_on') }}
              </NuxtLink>
            </span>
          </span>
        </label>

        <label class="flex min-h-touch items-start gap-3 text-sm">
          <input
            type="checkbox"
            class="mt-1 size-5 shrink-0 accent-brand"
            :checked="consentements.notifications"
            data-testid="consentement-notifications"
            @change="basculerConsentement('notifications', ($event.target as HTMLInputElement).checked)"
          >
          <span>
            <span class="font-medium text-ink">{{ $t('profil.index.notifications') }}</span>
            <span class="block text-ink-muted">
              {{ $t('profil.index.rappels_de_cotisation_et') }}
            </span>
          </span>
        </label>
      </section>

      <!-- Code d'accès -->
      <section class="card-surface flex flex-col gap-3 p-4">
        <h2 class="font-semibold text-ink">
          {{ $t('profil.index.verrouillage') }}
        </h2>
        <p class="text-sm text-ink-muted">
          {{ $t('profil.index.un_code_a_quatre') }}
        </p>

        <form
          class="flex flex-col gap-3"
          @submit.prevent="changerPin"
        >
          <label
            class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
            for="pin-actuel"
          >
            {{ $t('profil.index.code_actuel') }}
            <InputText
              id="pin-actuel"
              v-model="pinActuel"
              type="password"
              inputmode="numeric"
              autocomplete="current-password"
              maxlength="4"
              data-testid="champ-pin-actuel"
            />
          </label>

          <label
            class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
            for="pin-nouveau"
          >
            {{ $t('profil.index.nouveau_code') }}
            <InputText
              id="pin-nouveau"
              v-model="pin"
              type="password"
              inputmode="numeric"
              autocomplete="new-password"
              maxlength="4"
              data-testid="champ-pin"
            />
          </label>

          <p
            v-if="messagePin"
            role="status"
            class="text-sm text-ink-muted"
            data-testid="message-pin"
          >
            {{ messagePin }}
          </p>

          <Button
            type="submit"
            :label="$t('profil.index.changer_le_code')"
            :disabled="pin.length !== 4 || pinActuel.length !== 4"
            class="border border-line-strong bg-surface text-ink hover:bg-surface-muted"
            data-testid="bouton-pin"
          />

          <p class="text-sm text-ink-subtle">
            {{ $t('profil.index.code_oublie') }}
          </p>
        </form>
      </section>

      <NuxtLink
        to="/app/profil/canaux"
        class="min-h-touch flex items-center gap-2 text-sm text-brand underline underline-offset-4"
        data-testid="lien-canaux"
      >
        <Icon
          name="lucide:smartphone"
          size="1rem"
          aria-hidden="true"
        />
        {{ $t('profil.index.mes_numeros_de_collecte') }}
      </NuxtLink>

      <NuxtLink
        to="/app/abonnement"
        class="min-h-touch flex items-center gap-2 text-sm text-brand underline underline-offset-4"
        data-testid="lien-abonnement"
      >
        <Icon
          name="lucide:receipt-text"
          size="1rem"
          aria-hidden="true"
        />
        {{ $t('profil.index.mon_abonnement') }}
      </NuxtLink>

      <NuxtLink
        to="/app/profil/donnees"
        class="min-h-touch flex items-center gap-2 text-sm text-brand underline underline-offset-4"
        data-testid="lien-donnees"
      >
        <Icon
          name="lucide:database"
          size="1rem"
          aria-hidden="true"
        />
        {{ $t('profil.index.mes_donnees_personnelles') }}
      </NuxtLink>

      <button
        type="button"
        class="min-h-touch inline-flex items-center justify-center gap-2 rounded-control border border-line-strong bg-surface px-5 text-sm font-semibold text-ink"
        data-testid="bouton-deconnexion"
        @click="session.deconnecter()"
      >
        <Icon
          name="lucide:log-out"
          size="1rem"
          aria-hidden="true"
        />
        {{ $t('profil.index.me_deconnecter') }}
      </button>
    </template>
  </div>
</template>

<!--
  États d'écran (règle 14) :
  · chargement — squelette pendant la lecture des consentements
  · vide       — sans objet : un profil existe toujours dès qu'on est connecté
  · erreur     — ErrorState avec reprise
  · hors-ligne — bandeau porté par `layouts/app.vue`
  · contenu    — le formulaire
-->
