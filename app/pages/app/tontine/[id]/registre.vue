<script setup lang="ts">
/**
 * Registre de la tontine.
 *
 * **Lisible par tout membre actif**, sans distinction de rôle. C'est la pièce
 * qui remplace le carnet posé sur la table : un registre que seul le bureau
 * pourrait consulter ne vaudrait rien, et c'est précisément ce qu'on cherche à
 * remplacer.
 *
 * Le contrôle d'intégrité est offert à tout le monde, pas seulement au bureau :
 * n'importe qui peut vérifier que rien n'a été retouché, sans avoir à croire
 * quiconque sur parole.
 */
definePageMeta({ layout: 'app', middleware: 'auth' })

const route = useRoute()
const tontineId = route.params.id as string
const { formatDate } = useDate()

interface Ecriture {
  id: string
  type: string
  position: number
  serverTimestamp: string
  roundId: string | null
  payload: Record<string, unknown>
}

const LIBELLE: Record<string, string> = {
  contribution_declared: 'Cotisation déclarée',
  contribution_confirmed: 'Cotisation confirmée',
  contribution_rejected: 'Cotisation rejetée',
  penalty_applied: 'Amende appliquée',
  penalty_waived: 'Amende annulée',
  payout_declared: 'Pot versé',
  payout_acknowledged: 'Pot reçu',
  member_joined: 'Membre arrivé',
  member_left: 'Membre parti',
  rotation_changed: 'Ordre de passage fixé',
  settings_changed: 'Réglage modifié',
  reversal: 'Annulation',
  declaration_escalated: 'Déclaration en souffrance',
  cash_unconfirmed: 'Espèces non reconnues',
}

const ICONE: Record<string, string> = {
  contribution_declared: 'lucide:clock',
  contribution_confirmed: 'lucide:circle-check',
  contribution_rejected: 'lucide:octagon-alert',
  payout_declared: 'lucide:package',
  payout_acknowledged: 'lucide:circle-check',
  member_joined: 'lucide:user-check',
  member_left: 'lucide:log-out',
  rotation_changed: 'lucide:shuffle',
  declaration_escalated: 'lucide:triangle-alert',
  cash_unconfirmed: 'lucide:triangle-alert',
}

const etat = ref<'chargement' | 'contenu' | 'erreur'>('chargement')
const ecritures = ref<Ecriture[]>([])
const erreur = ref<string | null>(null)
const filtreType = ref('')
const verification = ref<{ valid: boolean, brokenAt?: number, reason?: string } | null>(null)
const verificationEnCours = ref(false)

const typesPresents = computed(() =>
  [...new Set(ecritures.value.map(e => e.type))].sort(),
)

const visibles = computed(() =>
  filtreType.value ? ecritures.value.filter(e => e.type === filtreType.value) : ecritures.value,
)

function message(e: unknown): string {
  return (e as { data?: { error?: { message?: string } } })?.data?.error?.message
    ?? 'Impossible de joindre le serveur.'
}

/** Le montant porté par une écriture, s'il y en a un. */
function montantDe(ecriture: Ecriture): number | null {
  const p = ecriture.payload
  for (const clef of ['amount', 'confirmedTotal', 'shortfall', 'expectedAmountPerRound']) {
    if (typeof p[clef] === 'number') return p[clef]
  }
  return null
}

async function charger() {
  etat.value = 'chargement'
  try {
    // La pagination est écrite dans l'adresse plutôt que passée en `query` :
    // l'inférence des routes typées de Nuxt part en récursion infinie quand un
    // littéral de gabarit rencontre un second argument d'options.
    const chemin = `/api/v1/tontines/${tontineId}/ledger?limit=100`
    const reponse = await $fetch<{ items: Ecriture[] }>(chemin)
    ecritures.value = reponse.items
    etat.value = 'contenu'
  }
  catch (e) {
    erreur.value = message(e)
    etat.value = 'erreur'
  }
}

async function verifier() {
  verificationEnCours.value = true
  try {
    // Type de retour explicite : sans lui, l'inférence des routes typées de
    // Nuxt part en récursion infinie sur cette adresse imbriquée.
    verification.value = await $fetch<{ valid: boolean, brokenAt?: number, reason?: string }>(
      `/api/v1/tontines/${tontineId}/ledger/verify`,
    )
  }
  catch (e) {
    erreur.value = message(e)
  }
  finally {
    verificationEnCours.value = false
  }
}

onMounted(charger)
useHead({ title: 'Registre — Tontine CI' })
</script>

<template>
  <div class="flex flex-col gap-5">
    <h1 class="text-xl font-bold text-ink">
      Registre
    </h1>

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
      v-else-if="ecritures.length === 0"
      title="Le registre est vide"
      description="Les écritures apparaîtront ici dès la première cotisation."
      icon="lucide:book-open"
    />

    <template v-else>
      <!-- Contrôle d'intégrité, ouvert à tous -->
      <section class="flex flex-col gap-2 rounded-card border border-line bg-surface p-4">
        <h2 class="font-semibold text-ink">
          Contrôle du registre
        </h2>
        <p class="text-sm text-ink-muted">
          Chaque écriture est chaînée à la précédente. Le contrôle vérifie qu’aucune
          n’a été modifiée ni supprimée après coup.
        </p>

        <Button
          :label="verificationEnCours ? 'Vérification…' : 'Vérifier le registre'"
          :disabled="verificationEnCours"
          class="border border-line-strong bg-surface text-ink hover:bg-surface-muted"
          data-testid="bouton-verifier-registre"
          @click="verifier"
        />

        <p
          v-if="verification?.valid"
          class="flex items-start gap-2 rounded-control bg-confirmed-surface p-3 text-sm text-confirmed-ink"
          role="status"
          data-testid="registre-intact"
        >
          <Icon
            name="lucide:circle-check"
            size="1rem"
            class="mt-0.5 shrink-0"
            aria-hidden="true"
          />
          Le registre est intact. Aucune écriture n’a été modifiée.
        </p>
        <p
          v-else-if="verification"
          class="flex items-start gap-2 rounded-control bg-disputed-surface p-3 text-sm text-disputed-ink"
          role="alert"
          data-testid="registre-rompu"
        >
          <Icon
            name="lucide:octagon-alert"
            size="1rem"
            class="mt-0.5 shrink-0"
            aria-hidden="true"
          />
          {{ verification.reason }}
        </p>
      </section>

      <!-- Filtres -->
      <label
        class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
        for="filtre-type"
      >
        Filtrer par type
        <select
          id="filtre-type"
          v-model="filtreType"
          class="min-h-touch rounded-control border border-line-strong bg-surface px-3 text-base text-ink"
          data-testid="filtre-type"
        >
          <option value="">
            Tout le registre
          </option>
          <option
            v-for="type in typesPresents"
            :key="type"
            :value="type"
          >
            {{ LIBELLE[type] ?? type }}
          </option>
        </select>
      </label>

      <!-- Liste de cartes empilées : jamais de tableau sous `md` (règle 11). -->
      <ul
        class="flex flex-col gap-2"
        data-testid="liste-registre"
      >
        <li
          v-for="ecriture in visibles"
          :key="ecriture.id"
          class="flex items-start gap-3 rounded-card border border-line bg-surface p-3"
          :data-testid="`ecriture-${ecriture.position}`"
        >
          <Icon
            :name="ICONE[ecriture.type] ?? 'lucide:circle-dashed'"
            size="1.25rem"
            class="mt-0.5 shrink-0 text-ink-subtle"
            aria-hidden="true"
          />

          <div class="flex flex-1 flex-col gap-1">
            <span class="font-medium text-ink">
              {{ LIBELLE[ecriture.type] ?? ecriture.type }}
            </span>
            <span class="text-sm text-ink-muted">
              {{ formatDate(ecriture.serverTimestamp) }} · écriture n° {{ ecriture.position }}
            </span>
          </div>

          <AmountDisplay
            v-if="montantDe(ecriture) !== null"
            :amount="montantDe(ecriture)"
            size="sm"
          />
        </li>
      </ul>

      <!-- Exports : générés côté serveur (règle 17). -->
      <section class="mt-auto flex flex-col gap-2 pt-2">
        <a
          :href="`/api/v1/tontines/${tontineId}/export?format=pdf`"
          class="min-h-touch inline-flex items-center justify-center gap-2 rounded-control border border-line-strong bg-surface px-5 font-semibold text-ink"
          data-testid="lien-export-pdf"
        >
          <Icon
            name="lucide:file-text"
            size="1rem"
            aria-hidden="true"
          />
          Procès-verbal du dernier tour (PDF)
        </a>
        <a
          :href="`/api/v1/tontines/${tontineId}/export?format=xlsx`"
          class="min-h-touch inline-flex items-center justify-center gap-2 rounded-control border border-line-strong bg-surface px-5 font-semibold text-ink"
          data-testid="lien-export-xlsx"
        >
          <Icon
            name="lucide:table"
            size="1rem"
            aria-hidden="true"
          />
          Registre complet (Excel)
        </a>
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
