<script setup lang="ts">
/**
 * Tableau de bord.
 *
 * Le bloc « à traiter aujourd'hui » vient **en premier**, avant l'historique et
 * avant les jauges : c'est lui qui remplace le carnet. Un membre ouvre
 * l'application pour savoir ce qu'il doit faire, pas pour consulter des
 * statistiques.
 *
 * Tout vient d'un **seul appel** (acceptation T21) : sur un téléphone en 3G au
 * marché, dix allers-retours sont la différence entre un écran qui s'affiche
 * et une application qu'on referme.
 *
 * Liste de cartes empilées, **jamais de tableau** (règle 11).
 */
definePageMeta({ layout: 'app', middleware: 'auth' })

const { formatRelativeDay } = useDate()

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
const erreur = ref<string | null>(null)

const ICONE: Record<string, string> = {
  cotisation_retard: 'lucide:triangle-alert',
  cotisation_due: 'lucide:hand-coins',
  confirmation_attente: 'lucide:clock',
  versement_a_faire: 'lucide:package',
  accuse_a_poser: 'lucide:circle-check',
}

function progression(t: TontineDuTableau): number {
  return t.potExpected > 0 ? Math.round((t.potCollected / t.potExpected) * 100) : 0
}

async function charger() {
  etat.value = 'chargement'
  try {
    const reponse = await $fetch<{ aTraiter: ATraiter[], tontines: TontineDuTableau[] }>(
      '/api/v1/dashboard',
    )
    aTraiter.value = reponse.aTraiter
    tontines.value = reponse.tontines
    etat.value = 'contenu'
  }
  catch (e) {
    erreur.value = (e as { data?: { error?: { message?: string } } })?.data?.error?.message
      ?? 'Impossible de joindre le serveur.'
    etat.value = 'erreur'
  }
}

onMounted(charger)
useHead({ title: 'Mes tontines — Tontine CI' })
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
        class="flex flex-col gap-2"
        data-testid="bloc-a-traiter"
      >
        <h1 class="text-xl font-bold text-ink">
          À traiter aujourd’hui
        </h1>

        <ul class="flex flex-col gap-2">
          <li
            v-for="(item, i) in aTraiter"
            :key="`${item.tontineId}-${item.type}-${i}`"
          >
            <NuxtLink
              :to="item.url"
              class="flex min-h-touch items-center gap-3 rounded-card border border-line bg-surface p-3"
              :data-testid="`a-traiter-${item.type}`"
            >
              <Icon
                :name="ICONE[item.type] ?? 'lucide:circle-dashed'"
                size="1.25rem"
                class="shrink-0 text-brand"
                aria-hidden="true"
              />
              <span class="flex flex-1 flex-col">
                <span class="font-medium text-ink">{{ item.libelle }}</span>
                <span class="text-sm text-ink-muted">{{ item.tontineName }}</span>
              </span>
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

      <h2
        v-if="aTraiter.length > 0 && tontines.length > 0"
        class="pt-2 text-lg font-semibold text-ink"
      >
        Mes tontines
      </h2>
      <h1
        v-else-if="tontines.length > 0"
        class="text-xl font-bold text-ink"
      >
        Mes tontines
      </h1>

      <EmptyState
        v-if="tontines.length === 0"
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

      <!-- Cartes empilées : aucun tableau, à aucune largeur. -->
      <ul
        v-else
        class="flex flex-col gap-3"
        data-testid="liste-tontines"
      >
        <li
          v-for="tontine in tontines"
          :key="tontine.id"
          class="flex flex-col gap-3 rounded-card border border-line bg-surface p-4"
          :data-testid="`carte-tontine-${tontine.id}`"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="flex flex-col gap-0.5">
              <NuxtLink
                :to="`/app/tontine/${tontine.id}/registre`"
                class="font-semibold text-ink"
              >
                {{ tontine.name }}
              </NuxtLink>
              <span
                v-if="tontine.locality"
                class="text-sm text-ink-muted"
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
                <span class="text-ink-muted">{{ progression(tontine) }} %</span>
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

            <div class="flex items-center justify-between gap-3">
              <span class="flex flex-col">
                <span class="text-sm text-ink-muted">Ce que je dois</span>
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

      <NuxtLink
        v-if="tontines.length > 0"
        to="/app/tontine/create"
        class="min-h-touch mt-auto inline-flex items-center justify-center gap-2 rounded-control border border-line-strong bg-surface px-5 font-semibold text-ink"
        data-testid="bouton-creer-tontine"
      >
        <Icon
          name="lucide:plus"
          size="1rem"
          aria-hidden="true"
        />
        Créer une tontine
      </NuxtLink>
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
