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
 * Retire le verrouillage.
 *
 * `DELETE /auth/pin` existait sans appelant : on posait un code et on ne
 * pouvait plus jamais l'ôter. Un verrou qu'on ne peut pas rendre finit par
 * enfermer quelqu'un dehors — un téléphone partagé, une personne qui oublie,
 * et l'application devient inutilisable.
 *
 * Le code courant reste exigé : sans lui, n'importe qui ayant le téléphone
 * en main lèverait le verrou censé le protéger.
 */
const retraitEnCours = ref(false)

async function retirerPin() {
  messagePin.value = null
  retraitEnCours.value = true
  try {
    await $fetch('/api/v1/auth/pin', {
      method: 'DELETE',
      body: { currentPin: pinActuel.value },
    })
    pin.value = ''
    pinActuel.value = ''
    await session.charger(true)
    messagePin.value = t('profil.index.code_de_verrouillage_retire')
  }
  catch (e) {
    messagePin.value = message(e)
  }
  finally {
    retraitEnCours.value = false
  }
}

/**
 * Code oublié : le retrait sans le code n'est accepté par le serveur que dans
 * les dix minutes qui suivent une connexion par SMS. L'écran de verrouillage y
 * envoie ; ici, on termine le geste.
 */
async function retirerPinOublie() {
  messagePin.value = null
  retraitEnCours.value = true
  try {
    await $fetch('/api/v1/auth/pin', { method: 'DELETE', body: {} })
    pin.value = ''
    pinActuel.value = ''
    await session.charger(true)
    messagePin.value = t('profil.index.code_de_verrouillage_retire_2')
  }
  catch (e) {
    messagePin.value = message(e)
  }
  finally {
    retraitEnCours.value = false
  }
}

/**
 * Changement de numéro. Deux temps, comme la connexion : le nouveau numéro,
 * puis le code reçu dessus. C'est le nouveau qu'on prouve — l'ancien peut
 * être perdu avec la SIM.
 */
const { format: formatTel, extraire, estComplet } = usePhoneMask()
const changementOuvert = ref(false)
const etapeNumero = ref<'numero' | 'code'>('numero')
const nouveauNumero = ref('')
const codeNumero = ref('')
const codeDevNumero = ref<string | null>(null)
const numeroEnCours = ref(false)
const messageNumero = ref<string | null>(null)
const erreurNumero = ref(false)

const nouveauNumeroAffiche = computed(() => formatTel(nouveauNumero.value))
const nouveauNumeroValide = computed(() => estComplet(nouveauNumero.value))

function onSaisieNouveauNumero(evenement: Event) {
  const champ = evenement.target as HTMLInputElement
  nouveauNumero.value = extraire(champ.value)
  champ.value = formatTel(nouveauNumero.value)
}

async function demanderCodeNumero() {
  messageNumero.value = null
  erreurNumero.value = false
  numeroEnCours.value = true
  try {
    const reponse = await $fetch<{ devCode?: string }>('/api/v1/me/phone/request', {
      method: 'POST',
      body: { phone: nouveauNumero.value },
    })
    codeDevNumero.value = reponse.devCode ?? null
    etapeNumero.value = 'code'
  }
  catch (e) {
    messageNumero.value = message(e)
    erreurNumero.value = true
  }
  finally {
    numeroEnCours.value = false
  }
}

async function validerNumero() {
  messageNumero.value = null
  erreurNumero.value = false
  numeroEnCours.value = true
  try {
    await $fetch('/api/v1/me/phone/verify', {
      method: 'POST',
      body: { phone: nouveauNumero.value, code: codeNumero.value },
    })
    await session.charger(true)
    changementOuvert.value = false
    etapeNumero.value = 'numero'
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

async function definirPin() {
  messagePin.value = null
  try {
    await $fetch('/api/v1/auth/pin', {
      method: 'POST',
      body: { pin: pin.value, ...(session.user?.hasPin ? { currentPin: pinActuel.value } : {}) },
    })
    pin.value = ''
    pinActuel.value = ''
    await session.charger(true)
    // Celui qui vient de poser le code n'a pas à le ressaisir dans la seconde :
    // l'onglet est déverrouillé, le verrou jouera à la prochaine ouverture.
    useVerrou().deverrouiller()
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

        <!-- Changement de numéro : un code sur le nouveau, puis un gel de
             quarante-huit heures sur les versements vers ce membre. Le numéro
             est l'identifiant du compte et l'adresse du pot — pas un champ
             de formulaire ordinaire. -->
        <form
          v-if="changementOuvert"
          class="flex flex-col gap-3 rounded-control bg-surface-muted p-3"
          data-testid="formulaire-numero"
          @submit.prevent="etapeNumero === 'numero' ? demanderCodeNumero() : validerNumero()"
        >
          <template v-if="etapeNumero === 'numero'">
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
            <p class="text-sm text-ink-subtle">
              {{ $t('profil.index.un_code_sera_envoye') }}
            </p>
          </template>

          <template v-else>
            <p class="text-sm text-ink-muted">
              {{ $t('profil.index.code_envoye_au') }} <span class="font-medium text-ink">{{ nouveauNumeroAffiche }}</span>.
            </p>
            <InputOtp
              v-model="codeNumero"
              :length="6"
              integer-only
              data-testid="champ-code-numero"
            />
            <p
              v-if="codeDevNumero"
              class="rounded-control bg-late-surface p-2 text-sm text-late-ink"
              data-testid="code-dev-numero"
            >
              {{ $t('profil.index.developpement_code') }} <strong>{{ codeDevNumero }}</strong>
            </p>
          </template>

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
            :label="numeroEnCours ? $t('commun.envoi_en_cours') : etapeNumero === 'numero' ? $t('commun.recevoir_le_code') : $t('profil.index.valider_le_nouveau_numero')"
            :disabled="numeroEnCours || (etapeNumero === 'numero' ? !nouveauNumeroValide : codeNumero.length !== 6)"
            class="bg-brand text-brand-ink hover:bg-brand-strong"
            data-testid="bouton-valider-numero"
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

      <!-- Verrouillage -->
      <section class="card-surface flex flex-col gap-3 p-4">
        <h2 class="font-semibold text-ink">
          {{ $t('profil.index.verrouillage') }}
        </h2>
        <p class="text-sm text-ink-muted">
          {{ $t('profil.index.un_code_a_quatre') }}
        </p>

        <form
          class="flex flex-col gap-3"
          @submit.prevent="definirPin"
        >
          <label
            v-if="session.user?.hasPin"
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
              data-testid="champ-pin-actuel"
            />
          </label>

          <label
            class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
            for="pin-nouveau"
          >
            {{ session.user?.hasPin ? $t('profil.index.nouveau_code') : $t('profil.index.code') }}
            <InputText
              id="pin-nouveau"
              v-model="pin"
              type="password"
              inputmode="numeric"
              autocomplete="new-password"
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
            :label="session.user?.hasPin ? $t('profil.index.changer_le_code') : $t('profil.index.definir_le_code')"
            :disabled="pin.length < 4"
            class="border border-line-strong bg-surface text-ink hover:bg-surface-muted"
            data-testid="bouton-pin"
          />

          <!-- Le retrait exige le code courant, comme le changement : c'est le
               même geste de preuve, pour la même raison. -->
          <Button
            v-if="session.user?.hasPin"
            type="button"
            :label="retraitEnCours ? $t('profil.index.retrait') : $t('profil.index.retirer_le_code')"
            :disabled="retraitEnCours || pinActuel.length < 4"
            class="text-ink-muted hover:text-ink"
            data-testid="bouton-retirer-pin"
            @click="retirerPin"
          />

          <!-- La porte de sortie de « code oublié » : après une connexion SMS
               récente, le serveur accepte le retrait sans l'ancien code. -->
          <button
            v-if="session.user?.hasPin"
            type="button"
            class="min-h-touch text-left text-sm text-ink-muted underline underline-offset-4"
            data-testid="bouton-pin-oublie"
            @click="retirerPinOublie"
          >
            {{ $t('profil.index.code_oublie_le_retirer') }}
          </button>
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
