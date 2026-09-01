<script setup lang="ts">
/**
 * File des dossiers d'identité.
 *
 * Du plus ancien au plus récent : quelqu'un qui attend depuis trois jours
 * passe avant celui qui a déposé ce matin. Une file triée à l'envers laisse
 * les dossiers difficiles s'enfoncer indéfiniment.
 */
interface Dossier {
  userId: string
  phone: string
  firstName: string | null
  lastName: string | null
  kycStatus: 'none' | 'pending_review' | 'approved' | 'rejected'
  submittedAt: string | null
  reviewedAt: string | null
  rejectionReason: string | null
}

const { formatDate } = useDate()

const etat = ref<'chargement' | 'contenu' | 'erreur'>('chargement')
const onglet = ref<'en_attente' | 'traites'>('en_attente')
const dossiers = ref<Dossier[]>([])
const nbEnAttente = ref(0)
const erreur = ref<string | null>(null)

async function charger() {
  etat.value = 'chargement'
  try {
    const chemin = `/api/dossiers?etat=${onglet.value}`
    const reponse = await $fetch<{ dossiers: Dossier[], nbEnAttente: number }>(chemin)
    dossiers.value = reponse.dossiers
    nbEnAttente.value = reponse.nbEnAttente
    etat.value = 'contenu'
  }
  catch (e) {
    erreur.value = (e as { data?: { error?: { message?: string } } })?.data?.error?.message
      ?? 'Impossible de joindre le serveur.'
    etat.value = 'erreur'
  }
}

function nom(d: Dossier): string {
  return [d.firstName, d.lastName].filter(Boolean).join(' ') || 'Nom non renseigné'
}

watch(onglet, charger)
onMounted(charger)

useHead({ title: 'Dossiers — Administration' })
</script>

<template>
  <div class="flex flex-col gap-5">
    <header class="flex items-baseline justify-between gap-4">
      <h1 class="text-xl font-bold text-ink">
        Dossiers d’identité
      </h1>
      <p
        v-if="nbEnAttente > 0"
        class="text-sm text-ink-muted"
        data-testid="compteur-attente"
      >
        {{ nbEnAttente }} en attente
      </p>
    </header>

    <div class="flex gap-1 border-b border-line">
      <button
        v-for="choix in [
          { clef: 'en_attente' as const, libelle: 'En attente' },
          { clef: 'traites' as const, libelle: 'Traités' },
        ]"
        :key="choix.clef"
        type="button"
        class="min-h-touch border-b-2 px-4 text-sm font-medium"
        :class="onglet === choix.clef
          ? 'border-brand text-ink'
          : 'border-transparent text-ink-muted hover:text-ink'"
        :data-testid="`filtre-${choix.clef}`"
        @click="onglet = choix.clef"
      >
        {{ choix.libelle }}
      </button>
    </div>

    <LoadingSkeleton
      v-if="etat === 'chargement'"
      variant="list"
      :count="4"
    />

    <ErrorState
      v-else-if="etat === 'erreur'"
      :detail="erreur ?? undefined"
      @retry="charger"
    />

    <EmptyState
      v-else-if="dossiers.length === 0"
      :title="onglet === 'en_attente' ? 'Aucun dossier en attente' : 'Aucun dossier traité'"
      :description="onglet === 'en_attente'
        ? 'Les dépôts de pièces d’identité apparaîtront ici, du plus ancien au plus récent.'
        : 'Les décisions déjà prises s’afficheront ici.'"
      icon="lucide:folder-check"
    />

    <!-- Liste de cartes, jamais de tableau : chaque ligne porte une décision,
         pas une donnée à comparer. -->
    <ul
      v-else
      class="flex flex-col gap-2"
      data-testid="liste-dossiers"
    >
      <li
        v-for="dossier in dossiers"
        :key="dossier.userId"
      >
        <NuxtLink
          :to="`/dossiers/${dossier.userId}`"
          class="flex min-h-touch items-center justify-between gap-4 card-surface p-4 hover:border-line-strong"
          :data-testid="`dossier-${dossier.userId}`"
        >
          <span class="flex flex-col gap-0.5">
            <span class="font-medium text-ink">{{ nom(dossier) }}</span>
            <span class="font-mono text-sm tabular-nums text-ink-muted">{{ dossier.phone }}</span>
            <span
              v-if="dossier.submittedAt"
              class="text-sm text-ink-subtle"
            >
              Déposé le {{ formatDate(dossier.submittedAt) }}
            </span>
          </span>

          <span class="flex items-center gap-3">
            <StatusBadge
              v-if="dossier.kycStatus === 'approved'"
              kind="membership"
              status="active"
              compact
            />
            <StatusBadge
              v-else-if="dossier.kycStatus === 'rejected'"
              kind="contribution"
              status="disputed"
              compact
            />
            <StatusBadge
              v-else
              kind="contribution"
              status="declared"
              compact
            />
            <Icon
              name="lucide:chevron-right"
              size="1.25rem"
              class="text-ink-subtle"
              aria-hidden="true"
            />
          </span>
        </NuxtLink>
      </li>
    </ul>
  </div>
</template>

<!--
  États d'écran (règle 14) :
  · chargement — LoadingSkeleton
  · vide       — EmptyState, distinct selon l'onglet
  · erreur     — ErrorState avec reprise
  · hors-ligne — sans objet : back-office desktop, sur poste connecté
  · contenu    — la file
-->
