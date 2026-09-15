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
const { t } = useI18n()

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
  rounds: Tour[]
  channels: Canal[]
  currentRound: { id: string, index: number, dueDate: string, status: string } | null
  publicationBlockers: Array<{ champ: string, message: string }>
}

/**
 * Un tour du cycle.
 *
 * « Je passe quand ? » est la première question qu'on se pose en ouvrant une
 * tontine, et l'écran n'y répondait pas : il ne montrait que le tour courant,
 * et la liste des membres donnait une position — « 5 » — sans jamais une date.
 */
interface Tour {
  id: string
  index: number
  dueDate: string
  status: 'pending' | 'collecting' | 'payout_pending' | 'closed'
  beneficiaryMembershipId: string
  beneficiaryName: string
}

const FREQUENCE: Record<Detail['frequency'], string> = {
  daily: t('tontine.index.chaque_jour'),
  weekly: t('tontine.index.chaque_semaine'),
  biweekly: t('tontine.index.tous_les_quinze_jours'),
  monthly: t('tontine.index.chaque_mois'),
}

const etat = ref<'chargement' | 'contenu' | 'erreur'>('chargement')
const tontine = ref<Detail | null>(null)
const erreur = ref<string | null>(null)

/** Mes adhésions servent à repérer mes tours dans le calendrier. */
const session = useSessionStore()
const mesAdhesions = computed(() => new Set(session.memberships.map(m => m.id)))

function estMonTour(tour: Tour): boolean {
  return mesAdhesions.value.has(tour.beneficiaryMembershipId)
}

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
      ?? t('commun.serveur_injoignable')
    etat.value = 'erreur'
  }
}

/**
 * Archiver une tontine terminée la sort du tableau de bord — pas du registre.
 * Sans ce geste, les cycles finis s'empilaient à l'accueil pour toujours.
 */
const archivageEnCours = ref(false)

async function archiver() {
  archivageEnCours.value = true
  try {
    await $fetch<{ ok: true }>(`/api/v1/tontines/${tontineId}/archive`, { method: 'POST' })
    await navigateTo('/app')
  }
  catch (e) {
    erreur.value = (e as { data?: { error?: { message?: string } } })?.data?.error?.message
      ?? t('commun.serveur_injoignable')
    etat.value = 'erreur'
  }
  finally {
    archivageEnCours.value = false
  }
}

onMounted(charger)

useEnTete(() => ({
  titre: tontine.value
    ? `${tontine.value.emoji ? `${tontine.value.emoji} ` : ''}${tontine.value.name}`
    : t('tontine.index.tontine'),
  sousTitre: tontine.value?.locality ?? undefined,
  retour: { to: '/app', label: t('commun.mes_tontines') },
}))
useHead({ title: t('tontine.index.ma_tontine_etontine') })
</script>

<template>
  <div class="flex flex-col gap-5">
    <TontineTabs
      :tontine-id="tontineId"
      :role="tontine?.myRole"
    />

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
          {{ $t('tontine.index.cette_tontine_n_est') }}
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

        <!-- `?id=` désigne **ce** brouillon : sans lui, le wizard reprenait
             celui que le navigateur avait gardé — vidé après chaque
             publication — et ouvrait une seconde tontine. -->
        <NuxtLink
          v-if="estPresident"
          :to="`/app/tontine/create?id=${tontineId}`"
          class="min-h-touch inline-flex items-center justify-center rounded-control bg-brand px-5 font-semibold text-brand-ink"
          data-testid="lien-reprendre-brouillon"
        >
          {{ $t('tontine.index.reprendre_la_configuration') }}
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
            {{ $t('tontine.index.tour_p0', { p0: tontine.currentRound.index }) }}
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
          {{ $t('tontine.index.echeance_p0', { p0: formatRelativeDay(tontine.currentRound.dueDate) }) }}
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
        <p
          v-if="tontine.status === 'open'"
          class="text-sm text-ink-muted"
        >
          {{ $t('tontine.index.la_tontine_n_a') }}
          <strong class="font-semibold text-ink">{{ formatDate(tontine.startDate) }}</strong>{{ $t('tontine.index.tu_seras_prevenu_au') }}
        </p>
        <!-- Un cycle fini ne promet pas de « prochain tour » : il n'y en aura
             pas. Ce qui reste, c'est le registre, les reçus et le procès-verbal. -->
        <template v-else-if="tontine.status === 'closed' || tontine.status === 'archived'">
          <p
            class="text-sm text-ink-muted"
            data-testid="tontine-terminee"
          >
            {{ $t('tontine.index.cette_tontine_est_terminee', { p0: tontine.rounds.length }) }}
          </p>
          <NuxtLink
            :to="`/app/tontine/${tontineId}/registre`"
            class="min-h-touch inline-flex items-center gap-2 text-sm font-semibold text-brand"
          >
            <Icon
              name="lucide:scroll-text"
              size="1rem"
              aria-hidden="true"
            />
            {{ $t('tontine.index.voir_le_registre_et') }}
          </NuxtLink>
          <Button
            v-if="estPresident && tontine.status === 'closed'"
            :label="archivageEnCours ? $t('tontine.index.archivage') : $t('tontine.index.archiver_cette_tontine')"
            :disabled="archivageEnCours"
            class="border border-line-strong bg-surface text-ink hover:bg-surface-muted"
            data-testid="bouton-archiver"
            @click="archiver"
          />
        </template>
        <p
          v-else
          class="text-sm text-ink-muted"
        >
          {{ $t('tontine.index.aucun_tour_n_est') }}
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
            <span class="text-xs tracking-wide text-ink-muted uppercase">{{ $t('tontine.index.ce_que_je_dois') }}</span>
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
          {{ $t('tontine.index.cotiser') }}
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
          {{ $t('tontine.index.tu_es_a_jour') }}
        </p>
      </section>

      <!-- Les réglages, en lecture. Les modifier est un autre écran. -->
      <section
        class="card-surface flex flex-col gap-3 p-4"
        data-testid="bloc-reglages"
      >
        <SectionTitle>
          {{ $t('tontine.index.comment_marche_cette_tontine') }}
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
              {{ $t('tontine.index.reglages') }}
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
              {{ $t('tontine.index.une_part') }}
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
              {{ $t('tontine.index.parts_au_total') }}
            </dt>
            <dd class="tabular font-medium text-ink">
              {{ tontine.totalShares }}
            </dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-ink-muted">
              {{ $t('tontine.index.membres_actifs') }}
            </dt>
            <dd class="tabular font-medium text-ink">
              {{ tontine.activeMembers }}
            </dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-ink-muted">
              {{ $t('tontine.index.pot_d_un_tour') }}
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
              {{ $t('tontine.index.ordre_de_passage') }}
            </dt>
            <dd class="font-medium text-ink">
              {{ tontine.rotationMode === 'draw' ? $t('tontine.index.tirage_au_sort') : $t('tontine.index.ordre_fixe') }}
            </dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-ink-muted">
              {{ $t('tontine.index.demarrage') }}
            </dt>
            <dd class="font-medium text-ink">
              {{ formatDate(tontine.startDate) }}
            </dd>
          </div>
        </dl>
      </section>

      <!-- Le calendrier de passage. La question qu'on vient poser en premier. -->
      <section
        v-if="tontine.rounds.length > 0"
        class="flex flex-col gap-3"
        data-testid="calendrier-tours"
      >
        <SectionTitle>{{ $t('tontine.index.ordre_de_passage') }}</SectionTitle>

        <ul class="flex flex-col gap-2">
          <li
            v-for="tour in tontine.rounds"
            :key="tour.id"
            class="flex items-center gap-3 rounded-control border p-3"
            :class="estMonTour(tour)
              ? 'border-brand bg-brand-surface'
              : 'border-line bg-surface'"
            :data-testid="`tour-${tour.index}`"
          >
            <span
              class="tabular flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-bold"
              :class="estMonTour(tour) ? 'bg-brand text-brand-ink' : 'bg-surface-muted text-ink-muted'"
              aria-hidden="true"
            >{{ tour.index }}</span>

            <div class="flex min-w-0 flex-1 flex-col gap-0.5">
              <span class="truncate text-sm font-semibold text-ink">
                {{ tour.beneficiaryName }}
                <!-- Le mot, pas seulement la teinte de la carte (règle 10). -->
                <span
                  v-if="estMonTour(tour)"
                  class="font-bold text-brand-strong"
                >{{ $t('tontine.index.c_est_toi') }}</span>
              </span>
              <span class="tabular text-sm text-ink-muted">
                {{ formatDate(tour.dueDate) }}
              </span>
            </div>

            <StatusBadge
              kind="round"
              :status="tour.status"
              compact
            />
          </li>
        </ul>
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
        {{ $t('tontine.index.le_pot_de_ce') }}
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
          {{ $t('tontine.index.confirmer_des_cotisations') }}
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
          {{ $t('tontine.index.verser_le_pot') }}
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
