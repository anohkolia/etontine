<script setup lang="ts">
/**
 * Retards, amendes, avances et contestations.
 *
 * L'amende affichée est un **calcul**, pas une dette : elle dit ce que le
 * barème donnerait. Rien n'est écrit tant que le président n'a pas décidé —
 * une amende qui tombe toute seule sur quelqu'un dont la moto est en panne,
 * c'est la tontine qui perd un membre.
 */
definePageMeta({ layout: 'app', middleware: 'auth' })

const route = useRoute()
const tontineId = route.params.id as string
const { formatRelativeDay } = useDate()

interface Retard {
  contributionId: string
  roundIndex: number
  dueDate: string
  nom: string
  rotationPosition: number
  restant: number
  status: 'late' | 'disputed'
  amendeCalculee: number
}
interface Amende {
  penalty: { id: string, amount: number, status: 'applied' | 'waived', reason: string | null, waiveReason: string | null }
  roundIndex: number
  managedName: string | null
}
interface Avance {
  advance: { id: string, amount: number, settledAt: string | null }
  roundIndex: number
}

const etat = ref<'chargement' | 'contenu' | 'erreur'>('chargement')
const donnees = ref<{
  myRole: string
  retards: Retard[]
  amendes: Amende[]
  avances: Avance[]
} | null>(null)
const erreur = ref<string | null>(null)

const montantAmende = ref<Record<string, number>>({})
const motifAnnulation = ref<Record<string, string>>({})
const enCours = ref<string | null>(null)

const estPresident = computed(() => donnees.value?.myRole === 'president')

function message(e: unknown): string {
  return (e as { data?: { error?: { message?: string } } })?.data?.error?.message
    ?? 'Impossible de joindre le serveur.'
}

async function charger() {
  etat.value = 'chargement'
  try {
    // Type de retour explicite : sans lui, l'inférence des routes typées de
    // Nuxt part en récursion infinie sur une adresse à segment dynamique.
    donnees.value = await $fetch<NonNullable<typeof donnees.value>>(
      `/api/v1/tontines/${tontineId}/impayes`,
    )
    for (const r of donnees.value!.retards) montantAmende.value[r.contributionId] = r.amendeCalculee
    etat.value = 'contenu'
  }
  catch (e) {
    erreur.value = message(e)
    etat.value = 'erreur'
  }
}

async function appliquer(contributionId: string) {
  erreur.value = null
  enCours.value = contributionId
  try {
    await $fetch(`/api/v1/contributions/${contributionId}/penalty`, {
      method: 'POST',
      body: { amount: montantAmende.value[contributionId] },
    })
    await charger()
  }
  catch (e) {
    erreur.value = message(e)
  }
  finally {
    enCours.value = null
  }
}

async function annuler(penaltyId: string) {
  erreur.value = null
  enCours.value = penaltyId
  try {
    await $fetch(`/api/v1/penalties/${penaltyId}/waive`, {
      method: 'POST',
      body: { reason: motifAnnulation.value[penaltyId] },
    })
    await charger()
  }
  catch (e) {
    erreur.value = message(e)
  }
  finally {
    enCours.value = null
  }
}

onMounted(charger)
useHead({ title: 'Retards et amendes — Tontine CI' })
</script>

<template>
  <div class="flex flex-col gap-5">
    <h1 class="text-xl font-bold text-ink">
      Retards et amendes
    </h1>

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

    <template v-else-if="donnees">
      <p
        v-if="erreur"
        role="alert"
        class="rounded-control bg-disputed-surface p-3 text-sm text-disputed-ink"
        data-testid="erreur-impayes"
      >
        {{ erreur }}
      </p>

      <!-- Retards -->
      <section class="flex flex-col gap-3">
        <h2 class="font-semibold text-ink">
          En retard
        </h2>

        <EmptyState
          v-if="donnees.retards.length === 0"
          title="Personne n’est en retard"
          description="Toutes les cotisations du tour sont à jour."
          icon="lucide:circle-check"
        />

        <ul
          v-else
          class="flex flex-col gap-3"
          data-testid="liste-retards"
        >
          <li
            v-for="retard in donnees.retards"
            :key="retard.contributionId"
            class="flex flex-col gap-3 rounded-card border border-line bg-surface p-4"
            :data-testid="`retard-${retard.contributionId}`"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="flex flex-col gap-1">
                <span class="font-medium text-ink">{{ retard.nom }}</span>
                <span class="text-sm text-ink-muted">
                  Tour {{ retard.roundIndex }} · part {{ retard.rotationPosition }}
                </span>
                <span class="text-sm text-late-ink">
                  Échéance {{ formatRelativeDay(retard.dueDate) }}
                </span>
              </div>
              <div class="flex flex-col items-end gap-2">
                <AmountDisplay
                  :amount="retard.restant"
                  size="lg"
                />
                <StatusBadge
                  kind="contribution"
                  :status="retard.status"
                  compact
                />
              </div>
            </div>

            <!-- L'amende est calculée, jamais appliquée d'office. -->
            <div
              v-if="estPresident && retard.amendeCalculee > 0"
              class="flex flex-col gap-2 rounded-control bg-surface-muted p-3"
            >
              <p class="text-sm text-ink-muted">
                Le barème donnerait
                <AmountDisplay
                  :amount="retard.amendeCalculee"
                  size="sm"
                />
                d’amende. Rien n’est appliqué tant que tu ne décides pas.
              </p>

              <label
                class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
                :for="`amende-${retard.contributionId}`"
              >
                Montant de l’amende (FCFA)
                <InputText
                  :id="`amende-${retard.contributionId}`"
                  :value="montantAmende[retard.contributionId]"
                  inputmode="numeric"
                  :data-testid="`champ-amende-${retard.contributionId}`"
                  @input="montantAmende[retard.contributionId] = Number(($event.target as HTMLInputElement).value.replace(/\D/g, '')) || 0"
                />
              </label>

              <Button
                :label="enCours === retard.contributionId ? 'Application…' : 'Appliquer l’amende'"
                :disabled="enCours !== null || !montantAmende[retard.contributionId]"
                class="border border-line-strong bg-surface text-ink hover:bg-surface-muted"
                :data-testid="`bouton-appliquer-amende-${retard.contributionId}`"
                @click="appliquer(retard.contributionId)"
              />
            </div>
          </li>
        </ul>
      </section>

      <!-- Amendes -->
      <section
        v-if="donnees.amendes.length > 0"
        class="flex flex-col gap-3"
      >
        <h2 class="font-semibold text-ink">
          Amendes
        </h2>
        <ul
          class="flex flex-col gap-3"
          data-testid="liste-amendes"
        >
          <li
            v-for="amende in donnees.amendes"
            :key="amende.penalty.id"
            class="flex flex-col gap-2 rounded-card border border-line bg-surface p-4"
            :data-testid="`amende-${amende.penalty.id}`"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="flex flex-col gap-1">
                <span class="font-medium text-ink">
                  {{ amende.managedName ?? 'Membre' }}
                </span>
                <span class="text-sm text-ink-muted">Tour {{ amende.roundIndex }}</span>
                <span
                  v-if="amende.penalty.reason"
                  class="text-sm text-ink-muted"
                >{{ amende.penalty.reason }}</span>
                <span
                  v-if="amende.penalty.status === 'waived'"
                  class="text-sm text-confirmed-ink"
                >
                  Annulée : {{ amende.penalty.waiveReason }}
                </span>
              </div>
              <AmountDisplay
                :amount="amende.penalty.amount"
                :muted="amende.penalty.status === 'waived'"
                size="lg"
              />
            </div>

            <div
              v-if="estPresident && amende.penalty.status === 'applied'"
              class="flex flex-col gap-2"
            >
              <label
                class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
                :for="`motif-${amende.penalty.id}`"
              >
                Motif d’annulation
                <InputText
                  :id="`motif-${amende.penalty.id}`"
                  v-model="motifAnnulation[amende.penalty.id]"
                  placeholder="Le membre était hospitalisé"
                  :data-testid="`champ-motif-annulation-${amende.penalty.id}`"
                />
                <span class="text-sm font-normal text-ink-subtle">
                  Obligatoire, et inscrit au registre : une amende qui disparaît
                  sans explication fait dire que le bureau arrange ses amis.
                </span>
              </label>
              <Button
                :label="enCours === amende.penalty.id ? 'Annulation…' : 'Annuler l’amende'"
                :disabled="enCours !== null || (motifAnnulation[amende.penalty.id]?.trim().length ?? 0) < 5"
                class="border border-line-strong bg-surface text-ink hover:bg-surface-muted"
                :data-testid="`bouton-annuler-amende-${amende.penalty.id}`"
                @click="annuler(amende.penalty.id)"
              />
            </div>
          </li>
        </ul>
      </section>

      <!-- Avances -->
      <section
        v-if="donnees.avances.length > 0"
        class="flex flex-col gap-3"
      >
        <h2 class="font-semibold text-ink">
          Avances entre membres
        </h2>
        <ul
          class="flex flex-col gap-2"
          data-testid="liste-avances"
        >
          <li
            v-for="avance in donnees.avances"
            :key="avance.advance.id"
            class="flex items-center justify-between gap-3 rounded-card border border-line bg-surface p-3"
          >
            <span class="text-sm text-ink-muted">
              Tour {{ avance.roundIndex }}
              <span v-if="avance.advance.settledAt"> · soldée</span>
            </span>
            <AmountDisplay
              :amount="avance.advance.amount"
              :muted="Boolean(avance.advance.settledAt)"
            />
          </li>
        </ul>
      </section>
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
