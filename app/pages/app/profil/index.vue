<script setup lang="ts">
/**
 * Profil : identité, verrouillage, consentements.
 *
 * Les consentements sont **deux cases distinctes** (acceptation T08) :
 * accepter le traitement de ses données pour faire tourner sa tontine n'est
 * pas accepter de recevoir des notifications. Les fusionner reviendrait à
 * extorquer le second en échange du premier.
 */
definePageMeta({ layout: 'app', middleware: 'auth' })

const session = useSessionStore()
const route = useRoute()

const prenom = ref(session.user?.firstName ?? '')
const nom = ref(session.user?.lastName ?? '')
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
    ?? 'Impossible de joindre le serveur.'
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
  enregistrement.value = true
  try {
    await $fetch('/api/v1/me', {
      method: 'PATCH',
      body: { firstName: prenom.value, lastName: nom.value },
    })
    await session.charger(true)
    messageProfil.value = 'Profil enregistré.'

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
    messagePin.value = 'Code de verrouillage enregistré.'
  }
  catch (e) {
    messagePin.value = message(e)
  }
}

useHead({ title: 'Mon profil — Tontine CI' })
</script>

<template>
  <div class="flex flex-col gap-6">
    <h1 class="text-xl font-bold text-ink">
      Mon profil
    </h1>

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
        Renseigne ton nom complet pour continuer.
      </p>

      <!-- Identité -->
      <section class="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
        <h2 class="font-semibold text-ink">
          Identité
        </h2>
        <p class="text-sm text-ink-muted">
          Ton numéro : <span class="font-medium text-ink">{{ session.user?.phone }}</span>
        </p>

        <form
          class="flex flex-col gap-3"
          @submit.prevent="enregistrerProfil"
        >
          <label
            class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
            for="prenom"
          >
            Prénom
            <InputText
              id="prenom"
              v-model="prenom"
              autocomplete="given-name"
              data-testid="champ-prenom"
            />
          </label>
          <label
            class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
            for="nom"
          >
            Nom
            <InputText
              id="nom"
              v-model="nom"
              autocomplete="family-name"
              data-testid="champ-nom"
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
            :label="enregistrement ? 'Enregistrement…' : 'Enregistrer'"
            :disabled="enregistrement"
            class="bg-brand text-brand-ink hover:bg-brand-strong"
            data-testid="bouton-enregistrer-profil"
          />
        </form>
      </section>

      <!-- Consentements : deux cases séparées, jamais une seule -->
      <section class="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
        <h2 class="font-semibold text-ink">
          Mes choix
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
            <span class="font-medium text-ink">Traitement de mes données</span>
            <span class="block text-ink-muted">
              Nécessaire pour tenir le registre de mes tontines.
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
            <span class="font-medium text-ink">Notifications</span>
            <span class="block text-ink-muted">
              Rappels de cotisation et activité de mes tontines. Refusable sans
              perdre l’accès à l’application.
            </span>
          </span>
        </label>
      </section>

      <!-- Verrouillage -->
      <section class="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
        <h2 class="font-semibold text-ink">
          Verrouillage
        </h2>
        <p class="text-sm text-ink-muted">
          Un code à quatre chiffres pour ouvrir l’application. Les téléphones se
          prêtent — le registre de ta tontine, non.
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
            Code actuel
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
            {{ session.user?.hasPin ? 'Nouveau code' : 'Code' }}
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
            :label="session.user?.hasPin ? 'Changer le code' : 'Définir le code'"
            :disabled="pin.length < 4"
            class="border border-line-strong bg-surface text-ink hover:bg-surface-muted"
            data-testid="bouton-pin"
          />
        </form>
      </section>

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
        Mes données personnelles
      </NuxtLink>

      <button
        type="button"
        class="min-h-touch text-left text-sm text-ink-muted underline underline-offset-4"
        data-testid="bouton-deconnexion"
        @click="session.deconnecter()"
      >
        Me déconnecter
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
