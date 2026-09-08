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
  roundId: string
  roundIndex: number
  dueDate: string
  nom: string
  membershipId: string
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
  advance: {
    id: string
    amount: number
    settledAt: string | null
    fromMembershipId: string
    toMembershipId: string
  }
  roundIndex: number
  nomPreteur: string
  nomBeneficiaire: string
}

interface MembreSimple { id: string, nom: string }

const etat = ref<'chargement' | 'contenu' | 'erreur'>('chargement')
const donnees = ref<{
  myRole: string
  membres: MembreSimple[]
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
    for (const r of donnees.value!.retards) {
      montantAmende.value[r.contributionId] = r.amendeCalculee
      montantAvance.value[r.contributionId] ??= r.restant
    }
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

/**
 * Avance entre membres : quelqu'un dépanne un proche, et la dette se règle plus
 * tard, de la main à la main.
 *
 * Le cas est fréquent et invisible dans les carnets papier. La route existait,
 * l'écran affichait les avances — et rien ne pouvait en créer une, ni en solder
 * une. Une reconnaissance de dette qu'on ne peut pas éteindre reste affichée
 * après le remboursement, et c'est elle qui déclenche la dispute suivante.
 *
 * L'avance ne touche **aucune cotisation** : elle ne paie rien, elle consigne
 * qui doit quoi à qui.
 */
const avanceOuverte = ref<string | null>(null)
const preteur = ref<Record<string, string>>({})
const montantAvance = ref<Record<string, number>>({})

async function enregistrerAvance(retard: Retard) {
  erreur.value = null
  enCours.value = retard.contributionId
  try {
    await $fetch('/api/v1/advances', {
      method: 'POST',
      body: {
        roundId: retard.roundId,
        fromMembershipId: preteur.value[retard.contributionId],
        toMembershipId: retard.membershipId,
        amount: montantAvance.value[retard.contributionId] ?? retard.restant,
      },
    })
    avanceOuverte.value = null
    await charger()
  }
  catch (e) {
    erreur.value = message(e)
  }
  finally {
    enCours.value = null
  }
}

async function solder(avanceId: string) {
  erreur.value = null
  enCours.value = avanceId
  try {
    await $fetch(`/api/v1/advances/${avanceId}/settle`, { method: 'POST' })
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
useEnTete(() => ({
  titre: 'Retards et amendes',
  retour: { to: '/app', label: 'Mes tontines' },
}))
useHead({ title: 'Retards et amendes — eTontine' })
</script>

<template>
  <div class="flex flex-col gap-5">
    <TontineTabs :tontine-id="tontineId" />

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
            class="flex flex-col gap-3 card-surface p-4"
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

            <!-- Quelqu'un a dépanné : on le consigne. L'avance ne paie pas la
                 cotisation, elle dit qui doit quoi à qui. -->
            <div
              v-if="estPresident"
              class="flex flex-col gap-2 border-t border-line pt-3"
            >
              <template v-if="avanceOuverte === retard.contributionId">
                <label
                  class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
                  :for="`preteur-${retard.contributionId}`"
                >
                  Qui a avancé ?
                  <select
                    :id="`preteur-${retard.contributionId}`"
                    v-model="preteur[retard.contributionId]"
                    class="min-h-touch rounded-control border border-line-strong bg-surface px-3 text-ink"
                    :data-testid="`champ-preteur-${retard.contributionId}`"
                  >
                    <option value="">
                      Choisir un membre
                    </option>
                    <option
                      v-for="membre in donnees.membres.filter(m => m.id !== retard.membershipId)"
                      :key="membre.id"
                      :value="membre.id"
                    >
                      {{ membre.nom }}
                    </option>
                  </select>
                </label>

                <label
                  class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
                  :for="`montant-avance-${retard.contributionId}`"
                >
                  Montant avancé (FCFA)
                  <InputText
                    :id="`montant-avance-${retard.contributionId}`"
                    :value="montantAvance[retard.contributionId]"
                    inputmode="numeric"
                    :data-testid="`champ-montant-avance-${retard.contributionId}`"
                    @input="montantAvance[retard.contributionId]
                      = Number(($event.target as HTMLInputElement).value.replace(/\D/g, '')) || 0"
                  />
                </label>

                <div class="flex flex-col gap-2 sm:flex-row">
                  <Button
                    :label="enCours === retard.contributionId ? 'Enregistrement…' : 'Enregistrer l’avance'"
                    :disabled="enCours !== null
                      || !preteur[retard.contributionId]
                      || !montantAvance[retard.contributionId]"
                    class="bg-brand text-brand-ink hover:bg-brand-strong sm:flex-1"
                    :data-testid="`bouton-enregistrer-avance-${retard.contributionId}`"
                    @click="enregistrerAvance(retard)"
                  />
                  <Button
                    label="Annuler"
                    class="border border-line-strong bg-surface text-ink hover:bg-surface-muted sm:flex-1"
                    @click="avanceOuverte = null"
                  />
                </div>
              </template>

              <Button
                v-else
                label="Quelqu’un a avancé pour lui"
                class="border border-line-strong bg-surface text-ink hover:bg-surface-muted"
                :data-testid="`bouton-avance-${retard.contributionId}`"
                @click="avanceOuverte = retard.contributionId"
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
            class="flex flex-col gap-2 card-surface p-4"
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
            class="flex flex-col gap-2 card-surface p-3"
            :data-testid="`avance-${avance.advance.id}`"
          >
            <div class="flex items-center justify-between gap-3">
              <!-- Qui a dépanné qui : c'est ce qu'on vient chercher ici, pas
                   un montant tout seul. -->
              <span class="min-w-0 text-sm text-ink">
                <strong class="font-semibold">{{ avance.nomPreteur }}</strong>
                a avancé pour
                <strong class="font-semibold">{{ avance.nomBeneficiaire }}</strong>
              </span>
              <AmountDisplay
                :amount="avance.advance.amount"
                :muted="Boolean(avance.advance.settledAt)"
              />
            </div>

            <div class="flex items-center justify-between gap-3">
              <span class="text-sm text-ink-muted">
                Tour {{ avance.roundIndex }}
                <span v-if="avance.advance.settledAt"> · soldée</span>
              </span>

              <Button
                v-if="estPresident && !avance.advance.settledAt"
                :label="enCours === avance.advance.id ? 'Enregistrement…' : 'Marquer soldée'"
                :disabled="enCours !== null"
                class="border border-line-strong bg-surface text-sm text-ink hover:bg-surface-muted"
                :data-testid="`bouton-solder-${avance.advance.id}`"
                @click="solder(avance.advance.id)"
              />
            </div>
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
