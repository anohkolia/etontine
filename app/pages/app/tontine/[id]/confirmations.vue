<script setup lang="ts">
/**
 * File de confirmation du trésorier.
 *
 * **Liste de cartes empilées, jamais de tableau** (règle 11) : cet écran se
 * consulte au marché, sur un téléphone tenu d'une main. Un tableau à six
 * colonnes y serait illisible.
 *
 * Un trésorier ne peut pas confirmer sa propre déclaration. Le bouton est
 * masqué pour lui, mais c'est le serveur qui refuse — l'affichage n'est qu'un
 * confort, pas un contrôle.
 */
definePageMeta({ layout: 'app', middleware: 'auth' })

const route = useRoute()
const tontineId = route.params.id as string
const { formatDate } = useDate()

interface EnAttente {
  declarationId: string
  contributionId: string
  amount: number
  channel: string
  providerRef: string | null
  proofUrl: string | null
  declaredAt: string
  source: 'member' | 'treasurer' | 'system'
  escalatedAt: string | null
  roundIndex: number
  rotationPosition: number
  memberName: string | null
  memberFirstName: string | null
  memberLastName: string | null
  expectedAmount: number
  confirmedAmount: number
  estLaMienne: boolean
}

const etat = ref<'chargement' | 'contenu' | 'erreur'>('chargement')
const items = ref<EnAttente[]>([])
const erreur = ref<string | null>(null)
const enCours = ref<string | null>(null)

const rejetOuvert = ref<string | null>(null)
const motifRejet = ref('')

const confirmables = computed(() => items.value.filter(i => !i.estLaMienne))

function nom(item: EnAttente): string {
  return [item.memberFirstName, item.memberLastName].filter(Boolean).join(' ')
    || item.memberName
    || 'Membre'
}

function message(e: unknown): string {
  return (e as { data?: { error?: { message?: string } } })?.data?.error?.message
    ?? 'Impossible de joindre le serveur.'
}

async function charger() {
  etat.value = 'chargement'
  try {
    const reponse = await $fetch<{ items: EnAttente[] }>(
      `/api/v1/tontines/${tontineId}/pending-confirmations`,
    )
    items.value = reponse.items
    etat.value = 'contenu'
  }
  catch (e) {
    erreur.value = message(e)
    etat.value = 'erreur'
  }
}

async function confirmer(id: string) {
  erreur.value = null
  enCours.value = id
  try {
    await $fetch(`/api/v1/declarations/${id}/confirm`, {
      method: 'POST',
      headers: { 'Idempotency-Key': crypto.randomUUID() },
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

async function rejeter(id: string) {
  erreur.value = null
  enCours.value = id
  try {
    await $fetch(`/api/v1/declarations/${id}/reject`, {
      method: 'POST',
      body: { reason: motifRejet.value },
    })
    rejetOuvert.value = null
    motifRejet.value = ''
    await charger()
  }
  catch (e) {
    erreur.value = message(e)
  }
  finally {
    enCours.value = null
  }
}

async function toutConfirmer() {
  erreur.value = null
  enCours.value = 'lot'
  try {
    await $fetch('/api/v1/declarations/bulk-confirm', {
      method: 'POST',
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      body: { ids: confirmables.value.map(i => i.declarationId) },
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
  titre: 'À confirmer',
  retour: { to: '/app', label: 'Mes tontines' },
}))
useHead({ title: 'À confirmer — eTontine' })
</script>

<template>
  <div class="flex flex-col gap-5">
    <TontineTabs :tontine-id="tontineId" />

    <LoadingSkeleton
      v-if="etat === 'chargement'"
      variant="card"
      :count="3"
    />

    <ErrorState
      v-else-if="etat === 'erreur'"
      :detail="erreur ?? undefined"
      @retry="charger"
    />

    <EmptyState
      v-else-if="items.length === 0"
      title="Rien à confirmer"
      description="Toutes les déclarations ont été traitées. Les nouvelles apparaîtront ici."
      icon="lucide:circle-check"
    />

    <template v-else>
      <ul
        class="flex flex-col gap-3"
        data-testid="file-confirmation"
      >
        <li
          v-for="item in items"
          :key="item.declarationId"
          class="flex flex-col gap-3 card-surface p-4"
          :data-testid="`declaration-${item.declarationId}`"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="flex flex-col gap-1">
              <span class="font-medium text-ink">{{ nom(item) }}</span>
              <span class="text-sm text-ink-muted">
                Tour {{ item.roundIndex }} · part {{ item.rotationPosition }}
              </span>
              <span class="text-sm text-ink-muted">
                Déclaré le {{ formatDate(item.declaredAt) }} · {{ item.channel }}
              </span>
              <span
                v-if="item.providerRef"
                class="font-mono text-sm text-ink-muted"
              >
                Réf. {{ item.providerRef }}
              </span>
            </div>

            <AmountDisplay
              :amount="item.amount"
              size="lg"
            />
          </div>

          <p
            v-if="item.source === 'treasurer'"
            class="flex items-start gap-2 rounded-control bg-surface-muted p-2 text-sm text-ink-muted"
          >
            <Icon
              name="lucide:hand-coins"
              size="0.875rem"
              class="mt-0.5 shrink-0"
              aria-hidden="true"
            />
            Versement en espèces enregistré par le bureau.
          </p>

          <p
            v-if="item.escalatedAt"
            class="flex items-start gap-2 rounded-control bg-late-surface p-2 text-sm text-late-ink"
            data-testid="alerte-escalade"
          >
            <Icon
              name="lucide:triangle-alert"
              size="0.875rem"
              class="mt-0.5 shrink-0"
              aria-hidden="true"
            />
            En attente depuis plus de 48 heures.
          </p>

          <a
            v-if="item.proofUrl"
            :href="item.proofUrl"
            target="_blank"
            rel="noopener"
            class="min-h-touch inline-flex items-center gap-2 text-sm text-brand underline underline-offset-4"
          >
            <Icon
              name="lucide:image"
              size="0.875rem"
              aria-hidden="true"
            />
            Voir la capture
          </a>

          <!-- Une déclaration faite par soi-même n'est pas confirmable : le
               serveur refuse, et on le dit plutôt que de laisser un bouton mort. -->
          <p
            v-if="item.estLaMienne"
            class="rounded-control bg-surface-muted p-2 text-sm text-ink-muted"
            :data-testid="`propre-declaration-${item.declarationId}`"
          >
            Tu as fait cette déclaration. Un autre membre du bureau doit la confirmer.
          </p>

          <div
            v-else-if="rejetOuvert === item.declarationId"
            class="flex flex-col gap-2"
          >
            <label
              class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
              :for="`motif-${item.declarationId}`"
            >
              Motif du rejet
              <InputText
                :id="`motif-${item.declarationId}`"
                v-model="motifRejet"
                placeholder="Aucun envoi retrouvé à ce montant"
                :data-testid="`champ-motif-${item.declarationId}`"
              />
              <span class="text-sm font-normal text-ink-subtle">
                Obligatoire : le membre doit savoir ce qui cloche pour corriger.
              </span>
            </label>
            <div class="flex flex-col gap-2 sm:flex-row">
              <Button
                label="Annuler"
                class="border border-line-strong bg-surface text-ink sm:flex-1"
                @click="rejetOuvert = null"
              />
              <Button
                label="Rejeter"
                :disabled="motifRejet.trim().length < 5 || enCours === item.declarationId"
                class="bg-disputed-ink text-surface sm:flex-1"
                :data-testid="`bouton-confirmer-rejet-${item.declarationId}`"
                @click="rejeter(item.declarationId)"
              />
            </div>
          </div>

          <div
            v-else
            class="flex flex-col gap-2 sm:flex-row"
          >
            <Button
              label="Rejeter"
              class="border border-disputed-ink bg-surface text-disputed-ink sm:flex-1"
              :data-testid="`bouton-rejeter-${item.declarationId}`"
              @click="rejetOuvert = item.declarationId; motifRejet = ''"
            />
            <Button
              :label="enCours === item.declarationId ? 'Confirmation…' : 'Confirmer'"
              :disabled="enCours === item.declarationId"
              class="bg-brand text-brand-ink hover:bg-brand-strong sm:flex-1"
              :data-testid="`bouton-confirmer-${item.declarationId}`"
              @click="confirmer(item.declarationId)"
            />
          </div>
        </li>
      </ul>

      <p
        v-if="erreur"
        role="alert"
        class="rounded-control bg-disputed-surface p-3 text-sm text-disputed-ink"
        data-testid="erreur-confirmations"
      >
        {{ erreur }}
      </p>

      <div
        v-if="confirmables.length > 1"
        class="mt-auto pt-2"
      >
        <Button
          :label="enCours === 'lot' ? 'Confirmation…' : `Tout confirmer (${confirmables.length})`"
          :disabled="enCours !== null"
          class="w-full bg-brand text-brand-ink hover:bg-brand-strong"
          data-testid="bouton-tout-confirmer"
          @click="toutConfirmer"
        />
      </div>
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
