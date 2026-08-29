<script setup lang="ts">
/**
 * Journal d'administration.
 *
 * Consultable par tout administrateur, y compris pour ses propres actions : un
 * journal que seul son auteur peut relire ne contrôle rien. Les consultations
 * de pièces y figurent au même titre que les décisions — regarder la pièce
 * d'identité de quelqu'un est une action.
 */
const { formatDate } = useDate()

interface Entree {
  id: string
  actorPhone: string
  action: string
  targetUserId: string | null
  payload: Record<string, unknown>
  createdAt: string
}

const LIBELLE: Record<string, string> = {
  kyc_approuve: 'Dossier approuvé',
  kyc_rejete: 'Dossier rejeté',
  kyc_piece_consultee: 'Pièce consultée',
}

const ICONE: Record<string, string> = {
  kyc_approuve: 'lucide:circle-check',
  kyc_rejete: 'lucide:octagon-alert',
  kyc_piece_consultee: 'lucide:eye',
}

const etat = ref<'chargement' | 'contenu' | 'erreur'>('chargement')
const entrees = ref<Entree[]>([])
const erreur = ref<string | null>(null)

async function charger() {
  etat.value = 'chargement'
  try {
    const reponse = await $fetch<{ entrees: Entree[] }>('/api/journal')
    entrees.value = reponse.entrees
    etat.value = 'contenu'
  }
  catch (e) {
    erreur.value = (e as { data?: { error?: { message?: string } } })?.data?.error?.message
      ?? 'Impossible de joindre le serveur.'
    etat.value = 'erreur'
  }
}

onMounted(charger)
useHead({ title: 'Journal — Administration' })
</script>

<template>
  <div class="flex flex-col gap-5">
    <h1 class="text-xl font-bold text-ink">
      Journal d’administration
    </h1>
    <p class="text-sm text-ink-muted">
      Toute décision et toute consultation de pièce y figurent, avec leur auteur.
    </p>

    <LoadingSkeleton
      v-if="etat === 'chargement'"
      variant="list"
      :count="5"
    />

    <ErrorState
      v-else-if="etat === 'erreur'"
      :detail="erreur ?? undefined"
      @retry="charger"
    />

    <EmptyState
      v-else-if="entrees.length === 0"
      title="Aucune action enregistrée"
      description="Le journal se remplira dès la première décision."
      icon="lucide:scroll-text"
    />

    <ul
      v-else
      class="flex flex-col gap-2"
      data-testid="liste-journal"
    >
      <li
        v-for="entree in entrees"
        :key="entree.id"
        class="flex items-start gap-3 rounded-card border border-line bg-surface p-3"
        :data-testid="`journal-${entree.action}`"
      >
        <Icon
          :name="ICONE[entree.action] ?? 'lucide:circle-dashed'"
          size="1.25rem"
          class="mt-0.5 shrink-0 text-ink-subtle"
          aria-hidden="true"
        />
        <div class="flex flex-1 flex-col gap-0.5">
          <span class="font-medium text-ink">
            {{ LIBELLE[entree.action] ?? entree.action }}
          </span>
          <span class="text-sm text-ink-muted">
            Par {{ entree.actorPhone }} · {{ formatDate(entree.createdAt) }}
          </span>
          <span
            v-if="entree.payload.motif"
            class="text-sm text-ink-subtle"
          >
            {{ entree.payload.motif }}
          </span>
        </div>
        <NuxtLink
          v-if="entree.targetUserId"
          :to="`/dossiers/${entree.targetUserId}`"
          class="min-h-touch inline-flex items-center text-sm text-brand underline underline-offset-4"
        >
          Voir le dossier
        </NuxtLink>
      </li>
    </ul>
  </div>
</template>

<!--
  États d'écran (règle 14) :
  · chargement — LoadingSkeleton
  · vide       — EmptyState
  · erreur     — ErrorState avec reprise
  · hors-ligne — sans objet : back-office desktop, sur poste connecté
  · contenu    — le journal
-->
