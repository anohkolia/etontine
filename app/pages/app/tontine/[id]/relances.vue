<script setup lang="ts">
/**
 * Relancer les retardataires par WhatsApp.
 *
 * **L'envoi est manuel, et l'écran le dit d'emblée.** Ce n'est pas une
 * limitation technique qu'on lèvera plus tard : une relance envoyée
 * automatiquement au nom du trésorier détruirait la seule chose qui fait
 * fonctionner une tontine — le fait que ce soit une personne qui parle à une
 * autre. Le bureau relit, adapte son ton, et choisit qui il relance.
 */
definePageMeta({ layout: 'app', middleware: 'auth' })

const route = useRoute()
const tontineId = route.params.id as string

interface Relance {
  membershipId: string
  nom: string
  msisdn: string | null
  url: string | null
  message: string
}

const etat = ref<'chargement' | 'contenu' | 'erreur'>('chargement')
const relances = ref<Relance[]>([])
const erreur = ref<string | null>(null)
const envoyes = ref<Set<string>>(new Set())

async function charger() {
  etat.value = 'chargement'
  try {
    const reponse = await $fetch<{ relances: Relance[] }>(
      `/api/v1/tontines/${tontineId}/reminders/whatsapp`,
    )
    relances.value = reponse.relances
    etat.value = 'contenu'
  }
  catch (e) {
    erreur.value = (e as { data?: { error?: { message?: string } } })?.data?.error?.message
      ?? 'Impossible de joindre le serveur.'
    etat.value = 'erreur'
  }
}

/** Suivi local : qui j'ai déjà relancé pendant cette session. */
function marquerEnvoye(membershipId: string) {
  envoyes.value = new Set([...envoyes.value, membershipId])
}

onMounted(charger)
useHead({ title: 'Relancer — Tontine CI' })
</script>

<template>
  <div class="flex flex-col gap-5">
    <h1 class="text-xl font-bold text-ink">
      Relancer
    </h1>

    <!-- Dit avant tout le reste, pas en petites lettres au bas de l'écran. -->
    <p
      class="flex items-start gap-2 rounded-card border border-declared-ink/20 bg-declared-surface p-4 text-sm text-declared-ink"
      data-testid="avertissement-envoi-manuel"
    >
      <Icon
        name="lucide:info"
        size="1rem"
        class="mt-0.5 shrink-0"
        aria-hidden="true"
      />
      <span>
        <strong class="font-semibold">Rien n’est envoyé automatiquement.</strong>
        Chaque bouton ouvre WhatsApp avec un message préparé. Tu le relis, tu le
        modifies si tu veux, et c’est toi qui envoies.
      </span>
    </p>

    <LoadingSkeleton
      v-if="etat === 'chargement'"
      variant="list"
      :count="3"
    />

    <ErrorState
      v-else-if="etat === 'erreur'"
      :detail="erreur ?? undefined"
      @retry="charger"
    />

    <EmptyState
      v-else-if="relances.length === 0"
      title="Personne à relancer"
      description="Toutes les cotisations du tour en cours sont déclarées ou confirmées."
      icon="lucide:circle-check"
    />

    <ul
      v-else
      class="flex flex-col gap-3"
      data-testid="liste-relances"
    >
      <li
        v-for="relance in relances"
        :key="relance.membershipId"
        class="flex flex-col gap-3 rounded-card border border-line bg-surface p-4"
        :data-testid="`relance-${relance.membershipId}`"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="flex flex-col gap-0.5">
            <span class="font-medium text-ink">{{ relance.nom }}</span>
            <span
              v-if="relance.msisdn"
              class="font-mono text-sm tabular-nums text-ink-muted"
            >{{ relance.msisdn }}</span>
          </div>
          <StatusBadge
            v-if="envoyes.has(relance.membershipId)"
            kind="contribution"
            status="declared"
            compact
          />
        </div>

        <p class="rounded-control bg-surface-muted p-3 text-sm text-ink-muted">
          {{ relance.message }}
        </p>

        <a
          v-if="relance.url"
          :href="relance.url"
          target="_blank"
          rel="noopener"
          class="min-h-touch inline-flex items-center justify-center gap-2 rounded-control bg-brand px-5 font-semibold text-brand-ink"
          :data-testid="`lien-relance-${relance.membershipId}`"
          @click="marquerEnvoye(relance.membershipId)"
        >
          <Icon
            name="lucide:message-circle"
            size="1rem"
            aria-hidden="true"
          />
          Ouvrir WhatsApp
        </a>

        <p
          v-else
          class="rounded-control bg-late-surface p-3 text-sm text-late-ink"
        >
          Ce membre n’a pas de numéro enregistré. Ajoute-le dans la fiche du
          membre pour pouvoir le relancer.
        </p>
      </li>
    </ul>
  </div>
</template>

<!--
  États d'écran (règle 14) :
  · chargement — squelette de liste
  · vide       — EmptyState « personne à relancer »
  · erreur     — ErrorState avec reprise
  · hors-ligne — bandeau porté par `layouts/app.vue`
  · contenu    — la liste des relances
-->
