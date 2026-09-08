<script setup lang="ts">
/**
 * Détail d'une tontine — le cycle en cours.
 *
 * L'écran manquait alors qu'il est le premier de la cartographie des routes
 * (§8 du cahier). Sans lui, les cartes du tableau de bord pointaient vers le
 * registre : on tombait sur l'historique comptable au lieu de l'état du tour.
 *
 * **Lisible par tout membre**, sans distinction de rôle : c'est l'écran qui
 * répond aux deux questions qu'on se pose en ouvrant l'application — où en est
 * le pot, et quand est-ce que je prends la main.
 *
 * Un seul appel peint l'écran. `GET /tontines/:id` renvoie déjà les réglages,
 * le tour courant, le pot attendu, le pot collecté et ce que je dois : le
 * serveur a tout sous la main, le client n'additionne rien (règle 2).
 */
definePageMeta({ layout: 'app', middleware: 'auth' })

const route = useRoute()
const tontineId = route.params.id as string
const { formatRelativeDay, formatDate } = useDate()

interface Canal {
  id: string
  provider: 'wave' | 'orange' | 'mtn' | 'moov'
  msisdn: string
  holderName: string
  frozenUntil: string | null
}

interface Detail {
  id: string
  name: string
  emoji: string | null
  description: string | null
  locality: string | null
  status: 'draft' | 'open' | 'running' | 'closed' | 'archived'
  access: string
  shareAmount: number
  frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly'
  startDate: string
  rotationMode: 'fixed' | 'draw'
  myRole: 'president' | 'treasurer' | 'auditor' | 'member'
  totalShares: number
  activeMembers: number
  expectedPot: number
  potCollected: number
  myRemaining: number
  myContributionStatus: 'due' | 'late' | 'declared' | 'confirmed' | 'disputed' | null
  /** Une contre-validation de versement attend l'utilisateur sur le tour courant. */
  awaitingMyCounterValidation: boolean
  channels: Canal[]
  currentRound: { id: string, index: number, dueDate: string, status: string } | null
  publicationBlockers: Array<{ champ: string, message: string }>
}

const FREQUENCE: Record<Detail['frequency'], string> = {
  daily: 'chaque jour',
  weekly: 'chaque semaine',
  biweekly: 'tous les quinze jours',
  monthly: 'chaque mois',
}

const etat = ref<'chargement' | 'contenu' | 'erreur'>('chargement')
const tontine = ref<Detail | null>(null)
const erreur = ref<string | null>(null)

const estPresident = computed(() => tontine.value?.myRole === 'president')
const estBureau = computed(() =>
  tontine.value?.myRole === 'president' || tontine.value?.myRole === 'treasurer',
)

async function charger() {
  etat.value = 'chargement'
  try {
    tontine.value = await $fetch<Detail>(`/api/v1/tontines/${tontineId}`)
    etat.value = 'contenu'
  }
  catch (e) {
    erreur.value = (e as { data?: { error?: { message?: string } } })?.data?.error?.message
      ?? 'Impossible de joindre le serveur.'
    etat.value = 'erreur'
  }
}

onMounted(charger)

useEnTete(() => ({
  titre: tontine.value
    ? `${tontine.value.emoji ? `${tontine.value.emoji} ` : ''}${tontine.value.name}`
    : 'Tontine',
  sousTitre: tontine.value?.locality ?? undefined,
  retour: { to: '/app', label: 'Mes tontines' },
}))
useHead({ title: 'Ma tontine — eTontine' })
</script>

<template>
  <div class="flex flex-col gap-5">
    <TontineTabs :tontine-id="tontineId" />

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

    <template v-else-if="tontine">
      <!-- Un brouillon n'a pas de tour : il a une liste de ce qui manque. -->
      <section
        v-if="tontine.status === 'draft'"
        class="card-surface flex flex-col gap-3 p-4"
        data-testid="bloc-brouillon"
      >
        <div class="flex items-center gap-2">
          <StatusBadge
            kind="tontine"
            :status="tontine.status"
            compact
          />
        </div>
        <p class="text-sm text-ink-muted">
          Cette tontine n’est pas encore publiée. Tes membres ne la voient pas.
        </p>

        <ul
          v-if="tontine.publicationBlockers.length > 0"
          class="flex flex-col gap-2"
          data-testid="blocages-publication"
        >
          <li
            v-for="blocage in tontine.publicationBlockers"
            :key="blocage.champ"
            class="flex items-start gap-2 rounded-control bg-late-surface p-3 text-sm text-late-ink"
          >
            <Icon
              name="lucide:triangle-alert"
              size="1rem"
              class="mt-0.5 shrink-0"
              aria-hidden="true"
            />
            {{ blocage.message }}
          </li>
        </ul>

        <NuxtLink
          v-if="estPresident"
          to="/app/tontine/create"
          class="min-h-touch inline-flex items-center justify-center rounded-control bg-brand px-5 font-semibold text-brand-ink"
          data-testid="lien-reprendre-brouillon"
        >
          Reprendre la configuration
        </NuxtLink>
      </section>

      <!-- Le tour en cours : la jauge, le bénéficiaire, l'échéance. -->
      <section
        v-else-if="tontine.currentRound"
        class="card-surface flex flex-col gap-3 p-4"
        data-testid="bloc-tour"
      >
        <div class="flex items-start justify-between gap-3">
          <p class="text-sm text-ink-muted">
            Tour {{ tontine.currentRound.index }}
          </p>
          <StatusBadge
            kind="round"
            :status="(tontine.currentRound.status as 'pending' | 'collecting' | 'payout_pending' | 'closed')"
            compact
          />
        </div>

        <PotGauge
          :collecte="tontine.potCollected"
          :objectif="tontine.expectedPot"
        />

        <p class="flex items-center gap-2 rounded-control bg-surface-muted p-3 text-sm text-ink-muted">
          <Icon
            name="lucide:calendar"
            size="1rem"
            class="shrink-0"
            aria-hidden="true"
          />
          Échéance {{ formatRelativeDay(tontine.currentRound.dueDate) }}
        </p>
      </section>

      <!-- Une tontine publiée mais pas démarrée. -->
      <section
        v-else
        class="card-surface flex flex-col gap-2 p-4"
        data-testid="bloc-sans-tour"
      >
        <StatusBadge
          kind="tontine"
          :status="tontine.status"
          compact
        />
        <p class="text-sm text-ink-muted">
          Aucun tour n’est ouvert pour l’instant. Tu seras prévenu à l’ouverture
          du prochain.
        </p>
      </section>

      <!-- Ce que je dois, et le bouton pour m'en acquitter. -->
      <section
        v-if="tontine.status === 'running'"
        class="card-surface flex flex-col gap-3 p-4"
        data-testid="bloc-ma-part"
      >
        <div class="flex items-center justify-between gap-3">
          <span class="flex flex-col">
            <span class="text-xs tracking-wide text-ink-muted uppercase">Ce que je dois</span>
            <AmountDisplay
              :amount="tontine.myRemaining"
              size="xl"
              data-testid="mon-du"
            />
          </span>
          <StatusBadge
            v-if="tontine.myContributionStatus"
            kind="contribution"
            :status="tontine.myContributionStatus"
            compact
          />
        </div>

        <NuxtLink
          v-if="tontine.myRemaining > 0"
          :to="`/app/tontine/${tontineId}/cotiser`"
          class="min-h-touch inline-flex items-center justify-center gap-2 rounded-control bg-brand px-5 font-semibold text-brand-ink"
          data-testid="lien-cotiser"
        >
          <Icon
            name="lucide:hand-coins"
            size="1rem"
            aria-hidden="true"
          />
          Cotiser
        </NuxtLink>
        <p
          v-else
          class="flex items-center gap-2 text-sm text-confirmed-ink"
        >
          <Icon
            name="lucide:circle-check"
            size="1rem"
            class="shrink-0"
            aria-hidden="true"
          />
          Tu es à jour sur ce tour.
        </p>
      </section>

      <!-- Les réglages, en lecture. Les modifier est un autre écran. -->
      <section
        class="card-surface flex flex-col gap-3 p-4"
        data-testid="bloc-reglages"
      >
        <SectionTitle>
          Comment marche cette tontine
          <template #action>
            <NuxtLink
              v-if="estPresident"
              :to="`/app/tontine/${tontineId}/reglages`"
              class="min-h-touch inline-flex items-center gap-1.5 text-sm font-semibold text-brand"
              data-testid="lien-reglages"
            >
              <Icon
                name="lucide:settings"
                size="1rem"
                aria-hidden="true"
              />
              Réglages
            </NuxtLink>
          </template>
        </SectionTitle>

        <p
          v-if="tontine.description"
          class="text-sm text-ink-muted"
        >
          {{ tontine.description }}
        </p>

        <dl class="flex flex-col gap-2 text-sm">
          <div class="flex justify-between gap-3">
            <dt class="text-ink-muted">
              Une part
            </dt>
            <dd>
              <AmountDisplay
                :amount="tontine.shareAmount"
                size="sm"
              />
              {{ FREQUENCE[tontine.frequency] }}
            </dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-ink-muted">
              Parts au total
            </dt>
            <dd class="tabular font-medium text-ink">
              {{ tontine.totalShares }}
            </dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-ink-muted">
              Membres actifs
            </dt>
            <dd class="tabular font-medium text-ink">
              {{ tontine.activeMembers }}
            </dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-ink-muted">
              Pot d’un tour
            </dt>
            <dd>
              <AmountDisplay
                :amount="tontine.expectedPot"
                size="sm"
              />
            </dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-ink-muted">
              Ordre de passage
            </dt>
            <dd class="font-medium text-ink">
              {{ tontine.rotationMode === 'draw' ? 'Tirage au sort' : 'Ordre fixe' }}
            </dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-ink-muted">
              Démarrage
            </dt>
            <dd class="font-medium text-ink">
              {{ formatDate(tontine.startDate) }}
            </dd>
          </div>
        </dl>
      </section>

      <!-- Le bénéficiaire du tour a une contre-validation à donner, et l'onglet
           « Verser » ne lui est pas montré : sans ce lien, il n'aurait aucun
           chemin vers l'écran où le versement l'attend. -->
      <NuxtLink
        v-if="tontine.awaitingMyCounterValidation && !estBureau"
        :to="`/app/tontine/${tontineId}/versement`"
        class="min-h-touch flex items-center gap-2 rounded-control border border-declared-ink/20 bg-declared-surface px-4 text-sm font-semibold text-declared-ink"
        data-testid="lien-contre-validation"
      >
        <Icon
          name="lucide:package"
          size="1rem"
          class="shrink-0"
          aria-hidden="true"
        />
        Le pot de ce tour te revient : vérifie le montant avant l’envoi
      </NuxtLink>

      <!-- Actions du bureau, groupées : elles ne concernent pas tout le monde. -->
      <div
        v-if="estBureau && tontine.status === 'running'"
        class="flex flex-col gap-2 sm:flex-row"
      >
        <NuxtLink
          :to="`/app/tontine/${tontineId}/confirmations`"
          class="min-h-touch inline-flex items-center justify-center gap-2 rounded-control border border-line-strong bg-surface px-4 text-sm font-semibold text-ink sm:flex-1"
        >
          <Icon
            name="lucide:check-check"
            size="1rem"
            aria-hidden="true"
          />
          Confirmer des cotisations
        </NuxtLink>
        <NuxtLink
          :to="`/app/tontine/${tontineId}/versement`"
          class="min-h-touch inline-flex items-center justify-center gap-2 rounded-control border border-line-strong bg-surface px-4 text-sm font-semibold text-ink sm:flex-1"
        >
          <Icon
            name="lucide:package"
            size="1rem"
            aria-hidden="true"
          />
          Verser le pot
        </NuxtLink>
      </div>
    </template>
  </div>
</template>

<!--
  États d'écran (règle 14) :
  · chargement — LoadingSkeleton
  · vide       — le brouillon et la tontine sans tour ouvert ont chacun leur bloc,
                 avec ce qui manque et ce qui va se passer
  · erreur     — ErrorState avec reprise
  · hors-ligne — bandeau porté par `layouts/app.vue`
  · contenu    — l'écran
-->
