<script setup lang="ts">
/**
 * Examen d'un dossier d'identité.
 *
 * Les deux pièces côte à côte, en grand : c'est tout l'intérêt d'un écran
 * large. Comparer un visage à une photo d'identité sur un téléphone n'a pas
 * de sens, et une vérification bâclée vaut moins que pas de vérification —
 * elle donne une assurance que rien ne justifie.
 *
 * **Chaque consultation de pièce est journalisée** côté serveur. Regarder la
 * pièce d'identité de quelqu'un est une action, pas une simple lecture.
 */
const route = useRoute()
const userId = route.params.id as string
const { formatDate } = useDate()

interface Dossier {
  userId: string
  phone: string
  firstName: string | null
  lastName: string | null
  kycStatus: 'none' | 'pending_review' | 'approved' | 'rejected'
  kycLevel: number
  submittedAt: string | null
  reviewedAt: string | null
  rejectionReason: string | null
  hasDocument: boolean
  hasSelfie: boolean
}

const etat = ref<'chargement' | 'contenu' | 'erreur'>('chargement')
const dossier = ref<Dossier | null>(null)
const erreur = ref<string | null>(null)

const motifRejet = ref('')
const rejetOuvert = ref(false)
const enCours = ref(false)
const decision = ref<string | null>(null)

const enAttente = computed(() => dossier.value?.kycStatus === 'pending_review')

function message(e: unknown): string {
  return (e as { data?: { error?: { message?: string } } })?.data?.error?.message
    ?? 'Impossible de joindre le serveur.'
}

async function charger() {
  etat.value = 'chargement'
  try {
    dossier.value = await $fetch<Dossier>(`/api/dossiers/${userId}`)
    etat.value = 'contenu'
  }
  catch (e) {
    erreur.value = message(e)
    etat.value = 'erreur'
  }
}

async function approuver() {
  erreur.value = null
  enCours.value = true
  try {
    await $fetch(`/api/dossiers/${userId}/approve`, { method: 'POST' })
    decision.value = 'Dossier approuvé. La personne peut désormais publier une tontine.'
    await charger()
  }
  catch (e) {
    erreur.value = message(e)
  }
  finally {
    enCours.value = false
  }
}

async function rejeter() {
  erreur.value = null
  enCours.value = true
  try {
    await $fetch(`/api/dossiers/${userId}/reject`, {
      method: 'POST',
      body: { reason: motifRejet.value },
    })
    decision.value = 'Dossier rejeté. La personne a reçu le motif et peut redéposer.'
    rejetOuvert.value = false
    await charger()
  }
  catch (e) {
    erreur.value = message(e)
  }
  finally {
    enCours.value = false
  }
}

onMounted(charger)

const nom = computed(() =>
  [dossier.value?.firstName, dossier.value?.lastName].filter(Boolean).join(' ')
  || 'Nom non renseigné',
)

useHead({ title: 'Dossier — Administration' })
</script>

<template>
  <div class="flex flex-col gap-5">
    <NuxtLink
      to="/dossiers"
      class="min-h-touch inline-flex w-fit items-center gap-2 text-sm text-ink-muted"
      data-testid="retour-liste"
    >
      <Icon
        name="lucide:chevron-left"
        size="1rem"
        aria-hidden="true"
      />
      Tous les dossiers
    </NuxtLink>

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

    <template v-else-if="dossier">
      <header class="flex items-start justify-between gap-4">
        <div class="flex flex-col gap-1">
          <h1
            class="text-xl font-bold text-ink"
            data-testid="nom-dossier"
          >
            {{ nom }}
          </h1>
          <p class="font-mono text-sm tabular-nums text-ink-muted">
            {{ dossier.phone }}
          </p>
          <p
            v-if="dossier.submittedAt"
            class="text-sm text-ink-subtle"
          >
            Déposé le {{ formatDate(dossier.submittedAt) }}
          </p>
        </div>

        <StatusBadge
          v-if="dossier.kycStatus === 'approved'"
          kind="membership"
          status="active"
          data-testid="statut-dossier"
        />
        <StatusBadge
          v-else-if="dossier.kycStatus === 'rejected'"
          kind="contribution"
          status="disputed"
          data-testid="statut-dossier"
        />
        <StatusBadge
          v-else
          kind="contribution"
          status="declared"
          data-testid="statut-dossier"
        />
      </header>

      <p
        v-if="decision"
        role="status"
        class="rounded-control bg-confirmed-surface p-3 text-sm text-confirmed-ink"
        data-testid="message-decision"
      >
        {{ decision }}
      </p>

      <p
        v-if="dossier.kycStatus === 'rejected' && dossier.rejectionReason"
        class="rounded-control bg-disputed-surface p-3 text-sm text-disputed-ink"
        data-testid="motif-precedent"
      >
        Motif du rejet : {{ dossier.rejectionReason }}
      </p>

      <!-- Les deux pièces côte à côte : c'est tout l'intérêt d'un écran large. -->
      <div class="grid gap-4 sm:grid-cols-2">
        <figure class="flex flex-col gap-2">
          <figcaption class="text-sm font-medium text-ink-muted">
            Pièce d’identité
          </figcaption>
          <img
            v-if="dossier.hasDocument"
            :src="`/api/dossiers/${userId}/piece?type=document`"
            alt="Pièce d’identité déposée"
            class="w-full card-surface"
            data-testid="piece-document"
          >
          <p
            v-else
            class="card-surface p-4 text-sm text-ink-subtle"
            data-testid="document-absent"
          >
            Aucune pièce déposée.
          </p>
        </figure>

        <figure class="flex flex-col gap-2">
          <figcaption class="text-sm font-medium text-ink-muted">
            Selfie
          </figcaption>
          <img
            v-if="dossier.hasSelfie"
            :src="`/api/dossiers/${userId}/piece?type=selfie`"
            alt="Selfie déposé"
            class="w-full card-surface"
            data-testid="piece-selfie"
          >
          <p
            v-else
            class="card-surface p-4 text-sm text-ink-subtle"
            data-testid="selfie-absent"
          >
            Aucun selfie déposé.
          </p>
        </figure>
      </div>

      <p
        v-if="erreur"
        role="alert"
        class="rounded-control bg-disputed-surface p-3 text-sm text-disputed-ink"
        data-testid="erreur-decision"
      >
        {{ erreur }}
      </p>

      <!-- Décision -->
      <section
        v-if="enAttente"
        class="flex flex-col gap-3 card-surface p-4"
      >
        <h2 class="font-semibold text-ink">
          Décision
        </h2>
        <p class="text-sm text-ink-muted">
          Approuver accorde le palier 2 : la personne pourra publier une tontine,
          et devenir le numéro vers lequel un groupe enverra son argent.
        </p>

        <template v-if="rejetOuvert">
          <label
            class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
            for="motif"
          >
            Motif du rejet
            <InputText
              id="motif"
              v-model="motifRejet"
              placeholder="La pièce est illisible : le numéro n’apparaît pas."
              data-testid="champ-motif"
            />
            <span class="text-sm font-normal text-ink-subtle">
              Obligatoire, et transmis à la personne. Un refus sans explication
              la fait redéposer la même chose.
            </span>
          </label>

          <div class="flex gap-2">
            <Button
              label="Annuler"
              class="border border-line-strong bg-surface text-ink"
              @click="rejetOuvert = false"
            />
            <Button
              :label="enCours ? 'Rejet…' : 'Confirmer le rejet'"
              :disabled="enCours || motifRejet.trim().length < 10"
              class="bg-disputed-ink text-surface"
              data-testid="bouton-confirmer-rejet"
              @click="rejeter"
            />
          </div>
        </template>

        <div
          v-else
          class="flex gap-2"
        >
          <Button
            label="Rejeter"
            class="border border-disputed-ink bg-surface text-disputed-ink"
            data-testid="bouton-rejeter"
            @click="rejetOuvert = true; motifRejet = ''"
          />
          <Button
            :label="enCours ? 'Approbation…' : 'Approuver'"
            :disabled="enCours"
            class="bg-brand text-brand-ink hover:bg-brand-strong"
            data-testid="bouton-approuver"
            @click="approuver"
          />
        </div>
      </section>

      <p
        v-else-if="dossier.reviewedAt"
        class="card-surface p-4 text-sm text-ink-muted"
        data-testid="deja-traite"
      >
        Ce dossier a été traité le {{ formatDate(dossier.reviewedAt) }}.
      </p>
    </template>
  </div>
</template>

<!--
  États d'écran (règle 14) :
  · chargement — LoadingSkeleton
  · vide       — sans objet : un dossier ouvert existe, sinon c'est une erreur
  · erreur     — ErrorState avec reprise, et messages en ligne pour les décisions
  · hors-ligne — sans objet : back-office desktop, sur poste connecté
  · contenu    — les pièces et la décision
-->
