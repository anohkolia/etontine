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

/** Une cotisation du tour en cours, vue par le bureau. */
interface Cotisation {
  id: string
  membershipId: string
  rotationPosition: number
  expectedAmount: number
  confirmedAmount: number
  status: string
  nom: string
}

const etat = ref<'chargement' | 'contenu' | 'erreur'>('chargement')
const items = ref<EnAttente[]>([])
const erreur = ref<string | null>(null)
const enCours = ref<string | null>(null)

const rejetOuvert = ref<string | null>(null)
const motifRejet = ref('')

/**
 * Enregistrement d'un versement en espèces, pour un membre qui a payé de la
 * main à la main.
 *
 * C'est le cas dominant ici, et il n'avait aucun écran : la route existait,
 * personne ne pouvait l'appeler. Un trésorier qui reçoit un billet devait donc
 * attendre que le membre déclare depuis une application qu'il n'a pas.
 *
 * Le membre reçoit ensuite une demande de reconnaissance — c'est la
 * contrepartie de la dissymétrie : celui qui n'a pas déclaré lui-même doit
 * pouvoir dire s'il reconnaît le versement.
 */
const aSolder = ref<Cotisation[]>([])
const especesOuvert = ref<string | null>(null)
const montantEspeces = ref<Record<string, number>>({})

function restantDe(c: Cotisation): number {
  return Math.max(0, c.expectedAmount - c.confirmedAmount)
}

async function enregistrerEspeces(cotisation: Cotisation) {
  erreur.value = null
  enCours.value = cotisation.id
  try {
    await $fetch(`/api/v1/contributions/${cotisation.id}/declare-cash`, {
      method: 'POST',
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      // `membershipId` est renvoyé au serveur, qui vérifie qu'il correspond
      // bien à la cotisation : le bureau ne peut pas enregistrer un versement
      // au nom d'un membre en visant la ligne d'un autre.
      body: {
        amount: montantEspeces.value[cotisation.id],
        channel: 'cash',
        membershipId: cotisation.membershipId,
      },
    })
    especesOuvert.value = null
    await charger()
  }
  catch (e) {
    erreur.value = message(e)
  }
  finally {
    enCours.value = null
  }
}

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

    // Les cotisations du tour en cours qui ne sont pas soldées : ce sont
    // celles pour lesquelles le bureau peut enregistrer des espèces.
    const detail = await $fetch<{ currentRound: { id: string } | null }>(
      `/api/v1/tontines/${tontineId}`,
    )

    if (detail.currentRound) {
      const cotisations = await $fetch<{ items: Cotisation[] }>(
        `/api/v1/rounds/${detail.currentRound.id}/contributions`,
      )
      aSolder.value = cotisations.items.filter(c => c.confirmedAmount < c.expectedAmount)
      for (const c of aSolder.value) montantEspeces.value[c.id] ??= restantDe(c)
    }
    else {
      aSolder.value = []
    }

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

    <template v-else>
      <!-- La file peut être vide sans que l'écran le soit : le bureau vient
           aussi ici pour enregistrer des espèces, et il n'y a rien à confirmer
           tant qu'il ne l'a pas fait. -->
      <EmptyState
        v-if="items.length === 0"
        title="Rien à confirmer"
        description="Toutes les déclarations ont été traitées. Les nouvelles apparaîtront ici."
        icon="lucide:circle-check"
      />

      <ul
        v-else
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

      <!-- Espèces reçues de la main à la main -->
      <section
        v-if="aSolder.length > 0"
        class="flex flex-col gap-3 card-surface p-4"
        data-testid="section-especes"
      >
        <h2 class="font-semibold text-ink">
          Enregistrer des espèces
        </h2>
        <p class="text-sm text-ink-muted">
          Pour un membre qui t’a remis l’argent en main propre. Il recevra une
          demande de confirmation : c’est lui qui dit s’il reconnaît le
          versement.
        </p>

        <ul class="flex flex-col gap-2">
          <li
            v-for="cotisation in aSolder"
            :key="cotisation.id"
            class="flex flex-col gap-2 rounded-control border border-line p-3"
            :data-testid="`especes-${cotisation.id}`"
          >
            <div class="flex items-baseline justify-between gap-3">
              <span class="truncate font-semibold text-ink">{{ cotisation.nom }}</span>
              <span class="shrink-0 text-sm text-ink-muted">
                reste <AmountDisplay
                  :amount="restantDe(cotisation)"
                  size="sm"
                />
              </span>
            </div>

            <template v-if="especesOuvert === cotisation.id">
              <label
                class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
                :for="`montant-especes-${cotisation.id}`"
              >
                Montant reçu (FCFA)
                <InputText
                  :id="`montant-especes-${cotisation.id}`"
                  :value="montantEspeces[cotisation.id]"
                  inputmode="numeric"
                  :data-testid="`champ-especes-${cotisation.id}`"
                  @input="montantEspeces[cotisation.id]
                    = Number(($event.target as HTMLInputElement).value.replace(/\D/g, '')) || 0"
                />
              </label>

              <div class="flex flex-col gap-2 sm:flex-row">
                <Button
                  :label="enCours === cotisation.id ? 'Enregistrement…' : 'Enregistrer'"
                  :disabled="enCours !== null || !montantEspeces[cotisation.id]"
                  class="bg-brand text-brand-ink hover:bg-brand-strong sm:flex-1"
                  :data-testid="`bouton-enregistrer-especes-${cotisation.id}`"
                  @click="enregistrerEspeces(cotisation)"
                />
                <Button
                  label="Annuler"
                  class="border border-line-strong bg-surface text-ink hover:bg-surface-muted sm:flex-1"
                  @click="especesOuvert = null"
                />
              </div>
            </template>

            <Button
              v-else
              label="Il a payé en espèces"
              class="border border-line-strong bg-surface text-ink hover:bg-surface-muted"
              :data-testid="`bouton-especes-${cotisation.id}`"
              @click="especesOuvert = cotisation.id"
            />
          </li>
        </ul>
      </section>

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
