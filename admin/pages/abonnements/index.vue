<script setup lang="ts">
/**
 * File des demandes d'abonnement.
 *
 * Rappel de ce que cet écran fait, et surtout de ce qu'il ne fait pas :
 * **l'application n'encaisse rien**. Le règlement se constate hors application
 * — le prélèvement récurrent n'est pas garanti sur les rails ivoiriens — et
 * l'administrateur ne fait ici qu'en tirer la conséquence : poser le palier.
 * Approuver sans avoir constaté le règlement n'est pas rattrapable par un
 * bouton, seulement par une nouvelle décision, elle-même journalisée.
 */
interface Demande {
  id: string
  userId: string
  phone: string
  firstName: string | null
  lastName: string | null
  tierActuel: string
  tier: string
  periodicity: 'monthly' | 'yearly'
  priceFcfa: number
  status: 'pending' | 'approved' | 'rejected'
  createdAt: string
  reviewedAt: string | null
  reviewNote: string | null
}

const { format } = useMoney()
const { formatDate } = useDate()

const etat = ref<'chargement' | 'contenu' | 'erreur'>('chargement')
const onglet = ref<'en_attente' | 'traitees'>('en_attente')
const demandes = ref<Demande[]>([])
const nbEnAttente = ref(0)
const erreur = ref<string | null>(null)

/** Le refus en cours de saisie, s'il y en a un. */
const refusOuvert = ref<string | null>(null)
const motif = ref('')
const enCours = ref<string | null>(null)

const NOMS: Record<string, string> = { free: 'Gratuit', standard: 'Standard', plus: 'Plus' }

function message(e: unknown): string {
  return (e as { data?: { error?: { message?: string } } })?.data?.error?.message
    ?? 'Impossible de joindre le serveur.'
}

async function charger() {
  etat.value = 'chargement'
  try {
    const reponse = await $fetch<{ demandes: Demande[], nbEnAttente: number }>(
      `/api/abonnements?etat=${onglet.value}`,
    )
    demandes.value = reponse.demandes
    nbEnAttente.value = reponse.nbEnAttente
    etat.value = 'contenu'
  }
  catch (e) {
    erreur.value = message(e)
    etat.value = 'erreur'
  }
}

async function approuver(id: string) {
  erreur.value = null
  enCours.value = id
  try {
    await $fetch(`/api/abonnements/${id}/approve`, { method: 'POST' })
    await charger()
  }
  catch (e) {
    erreur.value = message(e)
  }
  finally {
    enCours.value = null
  }
}

async function rejeter(id: string) {
  erreur.value = null
  enCours.value = id
  try {
    await $fetch(`/api/abonnements/${id}/reject`, {
      method: 'POST',
      body: { reason: motif.value },
    })
    refusOuvert.value = null
    motif.value = ''
    await charger()
  }
  catch (e) {
    erreur.value = message(e)
  }
  finally {
    enCours.value = null
  }
}

function nom(d: Demande): string {
  return [d.firstName, d.lastName].filter(Boolean).join(' ') || 'Nom non renseigné'
}

watch(onglet, charger)
onMounted(charger)

useHead({ title: 'Abonnements — Administration' })
</script>

<template>
  <div class="flex flex-col gap-5">
    <header class="flex items-baseline justify-between gap-4">
      <h1 class="text-xl font-bold text-ink">
        Demandes d’abonnement
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
          { clef: 'traitees' as const, libelle: 'Traitées' },
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
      :count="3"
    />

    <ErrorState
      v-else-if="etat === 'erreur'"
      :detail="erreur ?? undefined"
      @retry="charger"
    />

    <EmptyState
      v-else-if="demandes.length === 0"
      :title="onglet === 'en_attente' ? 'Aucune demande en attente' : 'Aucune demande traitée'"
      :description="onglet === 'en_attente'
        ? 'Les demandes de passage à un palier payant apparaîtront ici, du plus ancien au plus récent.'
        : 'Les décisions déjà prises s’afficheront ici.'"
      icon="lucide:receipt-text"
    />

    <ul
      v-else
      class="flex flex-col gap-2"
      data-testid="liste-demandes"
    >
      <li
        v-for="demande in demandes"
        :key="demande.id"
        class="card-surface flex flex-col gap-3 p-4"
        :data-testid="`demande-${demande.id}`"
      >
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="flex flex-col gap-0.5">
            <span class="font-medium text-ink">{{ nom(demande) }}</span>
            <span class="font-mono text-sm tabular-nums text-ink-muted">{{ demande.phone }}</span>
            <span class="text-sm text-ink-subtle">
              Demandé le {{ formatDate(demande.createdAt) }}
            </span>
          </div>

          <div class="flex flex-col items-end gap-0.5 text-right">
            <span class="font-semibold text-ink">
              {{ NOMS[demande.tierActuel] ?? demande.tierActuel }} → {{ NOMS[demande.tier] ?? demande.tier }}
            </span>
            <span class="amount text-sm text-ink-muted">
              {{ format(demande.priceFcfa) }}
              {{ demande.periodicity === 'yearly' ? 'par an' : 'par mois' }}
            </span>
          </div>
        </div>

        <p
          v-if="demande.status !== 'pending'"
          class="flex items-center gap-2 text-sm"
          :class="demande.status === 'approved' ? 'text-confirmed-ink' : 'text-disputed-ink'"
        >
          <Icon
            :name="demande.status === 'approved' ? 'lucide:circle-check' : 'lucide:circle-x'"
            size="1rem"
            aria-hidden="true"
          />
          {{ demande.status === 'approved' ? 'Approuvée' : 'Refusée' }}
          <span
            v-if="demande.reviewedAt"
            class="text-ink-subtle"
          >le {{ formatDate(demande.reviewedAt) }}</span>
          <span
            v-if="demande.reviewNote"
            class="text-ink-muted"
          >— {{ demande.reviewNote }}</span>
        </p>

        <template v-else>
          <div class="flex flex-wrap gap-2">
            <Button
              type="button"
              :label="enCours === demande.id ? 'Enregistrement…' : 'Approuver'"
              :disabled="enCours === demande.id"
              class="bg-brand text-brand-ink hover:bg-brand-strong"
              :data-testid="`approuver-${demande.id}`"
              @click="approuver(demande.id)"
            />
            <Button
              type="button"
              label="Refuser"
              class="border border-line-strong bg-surface text-ink hover:bg-surface-muted"
              :data-testid="`ouvrir-refus-${demande.id}`"
              @click="refusOuvert = refusOuvert === demande.id ? null : demande.id"
            />
          </div>

          <form
            v-if="refusOuvert === demande.id"
            class="flex flex-col gap-2"
            @submit.prevent="rejeter(demande.id)"
          >
            <label
              class="text-sm font-medium text-ink-muted"
              :for="`motif-${demande.id}`"
            >
              Motif du refus — il parvient au président
            </label>
            <InputText
              :id="`motif-${demande.id}`"
              v-model="motif"
              :data-testid="`motif-${demande.id}`"
            />
            <Button
              type="submit"
              label="Confirmer le refus"
              :disabled="motif.trim().length < 10 || enCours === demande.id"
              class="bg-disputed-surface text-disputed-ink"
              :data-testid="`refuser-${demande.id}`"
            />
          </form>
        </template>
      </li>
    </ul>

    <p
      v-if="erreur && etat === 'contenu'"
      role="alert"
      class="text-sm text-disputed-ink"
      data-testid="erreur-action"
    >
      {{ erreur }}
    </p>
  </div>
</template>

<!--
  États d'écran (règle 14) :
  · chargement — LoadingSkeleton
  · vide       — EmptyState, distinct selon l'onglet
  · erreur     — ErrorState au chargement, message en ligne sur une action
  · hors-ligne — sans objet : back-office desktop, sur poste connecté
  · contenu    — la file
-->
