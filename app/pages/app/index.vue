<script setup lang="ts">
/**
 * Tableau de bord.
 *
 * Le bloc « à traiter aujourd'hui » vient **en premier**, avant les chiffres et
 * avant la jauge : c'est lui qui remplace le carnet. Un membre ouvre
 * l'application pour savoir ce qu'il doit faire, pas pour consulter des
 * statistiques. C'est le seul endroit où l'on s'écarte de l'ordre du template,
 * qui ouvre sur ses tuiles de chiffres — l'acceptation T21 est explicite.
 *
 * Tout vient d'un **seul appel** (acceptation T21) : sur un téléphone en 3G au
 * marché, dix allers-retours sont la différence entre un écran qui s'affiche
 * et une application qu'on referme.
 *
 * Liste de cartes empilées, **jamais de tableau** (règle 11).
 */
definePageMeta({ layout: 'app', middleware: 'auth' })

const { formatRelativeDay } = useDate()
const session = useSessionStore()

interface ATraiter {
  type: string
  tontineId: string
  tontineName: string
  libelle: string
  nombre: number
  url: string
}

interface TontineDuTableau {
  id: string
  name: string
  emoji: string | null
  locality: string | null
  status: string
  myRole: string
  roundIndex: number | null
  nextDueDate: string | null
  myRemaining: number
  myContributionStatus: 'due' | 'late' | 'declared' | 'confirmed' | 'disputed' | null
  potCollected: number
  potExpected: number
  beneficiaryName: string | null
}

const etat = ref<'chargement' | 'contenu' | 'erreur'>('chargement')
const aTraiter = ref<ATraiter[]>([])
const tontines = ref<TontineDuTableau[]>([])

/**
 * Les demandes d'adhésion en attente de l'accord du président.
 *
 * Elles n'apparaissaient nulle part : le tableau de bord ne lit que les
 * adhésions actives. Après avoir rejoint par lien, on lisait « ta demande est
 * envoyée » — puis, au retour dans l'application, un écran vide. Rien ne disait
 * que la demande existait, ni qu'elle attendait quelqu'un.
 */
const demandes = ref<Array<{ tontineId: string, name: string, emoji: string | null, locality: string | null }>>([])
const erreur = ref<string | null>(null)

/**
 * Chaque type d'action reçoit son icône **et** sa teinte. Le sens ne repose
 * jamais sur la teinte seule : le libellé le porte (règle 10).
 */
const ACTION: Record<string, { icon: string, surface: string, ink: string }> = {
  cotisation_retard: { icon: 'lucide:triangle-alert', surface: 'bg-late-surface', ink: 'text-late-ink' },
  cotisation_due: { icon: 'lucide:hand-coins', surface: 'bg-brand-surface', ink: 'text-brand-strong' },
  confirmation_attente: { icon: 'lucide:clock', surface: 'bg-declared-surface', ink: 'text-declared-ink' },
  versement_a_faire: { icon: 'lucide:package', surface: 'bg-accent-surface', ink: 'text-accent-ink' },
  accuse_a_poser: { icon: 'lucide:circle-check', surface: 'bg-confirmed-surface', ink: 'text-confirmed-ink' },
}

function action(type: string) {
  return ACTION[type] ?? { icon: 'lucide:circle-dashed', surface: 'bg-due-surface', ink: 'text-due-ink' }
}

function progression(t: TontineDuTableau): number {
  return t.potExpected > 0 ? Math.round((t.potCollected / t.potExpected) * 100) : 0
}

/**
 * L'icône de la tontine, ou sa première lettre à défaut.
 *
 * Le président n'est pas obligé d'en choisir une : la pastille ne doit jamais
 * être vide, sinon la liste paraît cassée.
 */
function vignette(t: TontineDuTableau): string {
  return t.emoji ?? (t.name.trim()[0]?.toUpperCase() ?? '?')
}

/**
 * La tontine mise en avant par la jauge : la première qui a un tour ouvert.
 * Aucun montant n'est additionné ici — les deux valeurs de la jauge viennent
 * telles quelles du serveur (règle 2).
 */
const enVedette = computed(() => tontines.value.find(t => t.roundIndex !== null) ?? null)

async function charger() {
  etat.value = 'chargement'
  try {
    const reponse = await $fetch<{
      aTraiter: ATraiter[]
      tontines: TontineDuTableau[]
      demandes: typeof demandes.value
    }>(
      '/api/v1/dashboard',
    )
    aTraiter.value = reponse.aTraiter
    tontines.value = reponse.tontines
    demandes.value = reponse.demandes ?? []
    etat.value = 'contenu'
  }
  catch (e) {
    erreur.value = (e as { data?: { error?: { message?: string } } })?.data?.error?.message
      ?? 'Impossible de joindre le serveur.'
    etat.value = 'erreur'
  }
}

onMounted(charger)

// « Akwaba » — la bienvenue, reprise du template. Le mot est compris d'Abidjan
// à Bouaké et coûte moins cher en charge mentale qu'un « Bonjour » formel.
useEnTete(() => ({
  titre: session.user?.firstName ? `Akwaba, ${session.user.firstName}` : 'Akwaba',
  sousTitre: 'Vue d’ensemble de tes tontines',
}))
useHead({ title: 'Mes tontines — eTontine' })
</script>

<template>
  <div class="flex flex-col gap-5">
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
      <!-- À traiter aujourd'hui — en premier, toujours. -->
      <section
        v-if="aTraiter.length > 0"
        class="flex flex-col gap-3"
        data-testid="bloc-a-traiter"
      >
        <SectionTitle>À traiter aujourd’hui</SectionTitle>

        <ul class="flex flex-col gap-2">
          <li
            v-for="(item, i) in aTraiter"
            :key="`${item.tontineId}-${item.type}-${i}`"
          >
            <NuxtLink
              :to="item.url"
              class="card-surface flex min-h-touch items-center gap-3 p-3 transition-shadow hover:shadow-float"
              :data-testid="`a-traiter-${item.type}`"
            >
              <span
                class="flex size-touch shrink-0 items-center justify-center rounded-control"
                :class="[action(item.type).surface, action(item.type).ink]"
              >
                <Icon
                  :name="action(item.type).icon"
                  size="1.25rem"
                  aria-hidden="true"
                />
              </span>
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="truncate font-semibold text-ink">{{ item.libelle }}</span>
                <span class="truncate text-sm text-ink-muted">{{ item.tontineName }}</span>
              </span>
              <span
                v-if="item.nombre > 1"
                class="tabular shrink-0 rounded-full bg-surface-sunken px-2 py-0.5 text-xs font-bold text-ink"
              >{{ item.nombre }}</span>
              <Icon
                name="lucide:chevron-right"
                size="1.25rem"
                class="shrink-0 text-ink-subtle"
                aria-hidden="true"
              />
            </NuxtLink>
          </li>
        </ul>
      </section>

      <!-- Deux compteurs, jamais une somme d'argent : additionner des dus côté
           client est exactement ce que la règle 2 interdit. -->
      <div
        v-if="tontines.length > 0"
        class="grid grid-cols-2 gap-3"
      >
        <StatTile
          label="À traiter"
          :value="String(aTraiter.length)"
          :hint="aTraiter.length > 1 ? 'actions en attente' : 'action en attente'"
          :ton="aTraiter.length > 0 ? 'alerte' : 'neutre'"
        />
        <StatTile
          label="Mes tontines"
          :value="String(tontines.length)"
          hint="en cours"
        />
      </div>

      <!-- La jauge du tour en cours, sur la tontine la plus active. -->
      <section
        v-if="enVedette"
        class="card-surface p-4"
        data-testid="bloc-jauge"
      >
        <PotGauge
          :collecte="enVedette.potCollected"
          :objectif="enVedette.potExpected"
          :label="`${enVedette.emoji ? enVedette.emoji + ' ' : ''}${enVedette.name}`"
        />
        <p
          v-if="enVedette.beneficiaryName"
          class="mt-3 flex items-center gap-2 rounded-control bg-brand-surface p-3 text-xs text-brand-strong"
        >
          <Icon
            name="lucide:hand-coins"
            size="1rem"
            class="shrink-0"
            aria-hidden="true"
          />
          <span>
            Prend la main : <strong class="font-semibold">{{ enVedette.beneficiaryName }}</strong>
            <template v-if="enVedette.nextDueDate">
              · échéance {{ formatRelativeDay(enVedette.nextDueDate) }}
            </template>
          </span>
        </p>
      </section>

      <!-- Une demande en attente. Aucun montant : tant que le président n'a pas
           donné son accord, cette personne n'est pas du groupe. La carte ne
           mène nulle part non plus — le détail lui serait refusé. -->
      <section
        v-if="demandes.length > 0"
        class="flex flex-col gap-2"
        data-testid="demandes-en-attente"
      >
        <SectionTitle>En attente d’accord</SectionTitle>
        <ul class="flex flex-col gap-2">
          <li
            v-for="demande in demandes"
            :key="demande.tontineId"
            class="card-surface flex items-start gap-3 p-4"
            :data-testid="`demande-${demande.tontineId}`"
          >
            <span
              class="flex size-9 shrink-0 items-center justify-center rounded-control bg-declared-surface text-declared-ink"
              aria-hidden="true"
            >
              <Icon
                name="lucide:clock"
                size="1.125rem"
              />
            </span>
            <div class="flex min-w-0 flex-1 flex-col gap-1">
              <span class="truncate font-semibold text-ink">
                {{ demande.emoji ? `${demande.emoji} ` : '' }}{{ demande.name }}
              </span>
              <span class="text-sm text-ink-muted">
                Ta demande est partie. Le président doit l’accepter avant que tu
                puisses cotiser.
              </span>
            </div>
          </li>
        </ul>
      </section>

      <EmptyState
        v-if="tontines.length === 0 && demandes.length === 0"
        title="Tu n’as pas encore de tontine"
        description="Crée la tienne, ou rejoins celle d’un proche avec le lien qu’il t’a envoyé."
        icon="lucide:hand-coins"
      >
        <template #action>
          <NuxtLink
            to="/app/tontine/create"
            class="min-h-touch inline-flex items-center justify-center rounded-control bg-brand px-5 font-semibold text-brand-ink"
            data-testid="bouton-creer-tontine"
          >
            Créer une tontine
          </NuxtLink>
        </template>
      </EmptyState>

      <!-- `v-else-if` et non `v-else` : sans tontine mais avec une demande en
           attente, l'état vide ne s'affiche pas — et un simple `v-else` ferait
           alors rendre « Mes tontines » au-dessus d'une liste vide. -->
      <template v-else-if="tontines.length > 0">
        <SectionTitle>
          Mes tontines
          <template #action>
            <NuxtLink
              to="/app/tontine/create"
              class="min-h-touch inline-flex items-center gap-1 text-sm font-semibold text-brand"
              data-testid="bouton-creer-tontine"
            >
              <Icon
                name="lucide:plus"
                size="1rem"
                aria-hidden="true"
              />
              Nouvelle
            </NuxtLink>
          </template>
        </SectionTitle>

        <!-- Cartes empilées : aucun tableau, à aucune largeur. -->
        <ul
          class="flex flex-col gap-3"
          data-testid="liste-tontines"
        >
          <li
            v-for="tontine in tontines"
            :key="tontine.id"
            class="card-surface flex flex-col gap-3 p-4"
            :data-testid="`carte-tontine-${tontine.id}`"
          >
            <div class="flex items-start gap-3">
              <span
                class="flex size-11 shrink-0 items-center justify-center rounded-tile bg-brand-surface text-lg font-bold text-brand-strong"
                aria-hidden="true"
                :data-testid="`vignette-${tontine.id}`"
              >{{ vignette(tontine) }}</span>

              <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                <NuxtLink
                  :to="`/app/tontine/${tontine.id}`"
                  class="truncate font-semibold text-ink"
                  :data-testid="`lien-tontine-${tontine.id}`"
                >
                  {{ tontine.name }}
                </NuxtLink>
                <span
                  v-if="tontine.locality"
                  class="truncate text-sm text-ink-muted"
                >{{ tontine.locality }}</span>
              </div>

              <StatusBadge
                kind="tontine"
                :status="(tontine.status as 'draft' | 'open' | 'running' | 'closed' | 'archived')"
                compact
              />
            </div>

            <template v-if="tontine.roundIndex !== null">
              <div class="flex flex-col gap-1">
                <div class="flex items-baseline justify-between gap-2 text-sm">
                  <span class="text-ink-muted">
                    Tour {{ tontine.roundIndex }} · pot constitué
                  </span>
                  <span class="tabular text-ink-muted">{{ progression(tontine) }} %</span>
                </div>
                <ProgressBar
                  :value="progression(tontine)"
                  :aria-label="`Pot constitué à ${progression(tontine)} %`"
                />
                <p class="text-sm text-ink-muted">
                  <AmountDisplay
                    :amount="tontine.potCollected"
                    size="sm"
                  />
                  sur
                  <AmountDisplay
                    :amount="tontine.potExpected"
                    size="sm"
                  />
                </p>
              </div>

              <p
                v-if="tontine.beneficiaryName"
                class="text-sm text-ink-muted"
              >
                Prend la main : <span class="font-medium text-ink">{{ tontine.beneficiaryName }}</span>
              </p>

              <div class="flex items-center justify-between gap-3 rounded-control bg-surface-muted p-3">
                <span class="flex flex-col">
                  <span class="text-xs tracking-wide text-ink-muted uppercase">Ce que je dois</span>
                  <AmountDisplay
                    :amount="tontine.myRemaining"
                    size="lg"
                  />
                </span>

                <StatusBadge
                  v-if="tontine.myContributionStatus"
                  kind="contribution"
                  :status="tontine.myContributionStatus"
                  compact
                />
              </div>

              <p
                v-if="tontine.nextDueDate"
                class="text-sm text-ink-muted"
              >
                Échéance {{ formatRelativeDay(tontine.nextDueDate) }}
              </p>
            </template>

            <!-- Actions rapides, à portée de pouce. -->
            <div class="flex flex-col gap-2 sm:flex-row">
              <NuxtLink
                v-if="tontine.myRemaining > 0"
                :to="`/app/tontine/${tontine.id}/cotiser`"
                class="min-h-touch inline-flex items-center justify-center rounded-control bg-brand px-4 text-sm font-semibold text-brand-ink sm:flex-1"
                :data-testid="`action-cotiser-${tontine.id}`"
              >
                Cotiser
              </NuxtLink>
              <NuxtLink
                v-if="tontine.myRole === 'treasurer' || tontine.myRole === 'president'"
                :to="`/app/tontine/${tontine.id}/confirmations`"
                class="min-h-touch inline-flex items-center justify-center rounded-control border border-line-strong bg-surface px-4 text-sm font-semibold text-ink sm:flex-1"
              >
                Confirmer
              </NuxtLink>
              <NuxtLink
                :to="`/app/tontine/${tontine.id}/membres`"
                class="min-h-touch inline-flex items-center justify-center rounded-control border border-line-strong bg-surface px-4 text-sm font-semibold text-ink sm:flex-1"
              >
                Membres
              </NuxtLink>
            </div>
          </li>
        </ul>
      </template>
    </template>
  </div>
</template>

<!--
  États d'écran (règle 14) :
  · chargement — LoadingSkeleton
  · vide       — EmptyState
  · erreur     — ErrorState avec reprise
  · hors-ligne — bandeau porté par `layouts/app.vue`
  · contenu    — l'écran
-->
