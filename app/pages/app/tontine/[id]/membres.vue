<script setup lang="ts">
/**
 * Membres, parts et ordre de passage.
 *
 * Le nombre de parts est affiché explicitement, et un membre à double part
 * montre ses **deux** positions. Ce n'est pas un détail d'affichage : c'est
 * l'endroit où le bureau vérifie que la rotation correspond à ce qui a été
 * convenu de vive voix.
 */
definePageMeta({ layout: 'app', middleware: 'auth' })

const route = useRoute()
const tontineId = route.params.id as string

interface Membre {
  id: string
  userId: string | null
  name: string | null
  phone: string | null
  role: 'president' | 'treasurer' | 'auditor' | 'member'
  status: 'invited' | 'pending_approval' | 'active' | 'left' | 'defaulted'
  positions: number[]
  shares: number
}

const etat = ref<'chargement' | 'contenu' | 'erreur'>('chargement')
const membres = ref<Membre[]>([])
const tontine = ref<{
  name: string
  status: string
  myRole: string
  totalShares: number
  expectedPot: number
  shareAmount: number
  frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly'
} | null>(null)
const erreur = ref<string | null>(null)

const nouveauNom = ref('')
const nouveauNumero = ref('')
const nouvellesParts = ref(1)
const ajoutEnCours = ref(false)

const estPresident = computed(() => tontine.value?.myRole === 'president')

/**
 * Les adhésions arrivées par lien, en attente de l'accord du président.
 *
 * Sans cet écran, elles restaient en `pending_approval` pour toujours : aucune
 * part, aucune place dans la rotation, et jamais les trois membres actifs
 * qu'exige le démarrage. Un lien d'invitation ne menait donc nulle part.
 */
const enAttente = computed(() => membres.value.filter(m => m.status === 'pending_approval'))

const partsApprobation = ref<Record<string, number>>({})
const decisionEnCours = ref<string | null>(null)

function partsDe(membreId: string): number {
  return partsApprobation.value[membreId] ?? 1
}

async function decider(membreId: string, status: 'active' | 'left') {
  erreur.value = null
  decisionEnCours.value = membreId
  try {
    await $fetch(`/api/v1/tontines/${tontineId}/members/${membreId}`, {
      method: 'PATCH',
      body: status === 'active'
        ? { status, shares: partsDe(membreId) }
        : { status },
    })
    await charger()
  }
  catch (e) {
    erreur.value = message(e)
  }
  finally {
    decisionEnCours.value = null
  }
}

const invitation = ref<{ url: string, token: string } | null>(null)
const { phrase } = useEngagement()

const engagement = computed(() =>
  tontine.value
    ? phrase(tontine.value.shareAmount, tontine.value.totalShares, tontine.value.frequency)
    : '',
)

async function creerLien() {
  erreur.value = null
  try {
    invitation.value = await $fetch<{ url: string, token: string }>(
      `/api/v1/tontines/${tontineId}/invites`,
      { method: 'POST' },
    )
  }
  catch (e) {
    erreur.value = message(e)
  }
}
const peutDemarrer = computed(() =>
  estPresident.value
  && tontine.value?.status === 'open'
  && membres.value.filter(m => m.status === 'active').length >= 3,
)

function message(e: unknown): string {
  return (e as { data?: { error?: { message?: string } } })?.data?.error?.message
    ?? 'Impossible de joindre le serveur.'
}

async function charger() {
  etat.value = 'chargement'
  try {
    const [detail, liste] = await Promise.all([
      $fetch<typeof tontine.value>(`/api/v1/tontines/${tontineId}`),
      $fetch<{ members: Membre[] }>(`/api/v1/tontines/${tontineId}/members`),
    ])
    tontine.value = detail
    membres.value = liste.members
    etat.value = 'contenu'
  }
  catch (e) {
    erreur.value = message(e)
    etat.value = 'erreur'
  }
}

async function ajouter() {
  erreur.value = null
  ajoutEnCours.value = true
  try {
    await $fetch(`/api/v1/tontines/${tontineId}/members`, {
      method: 'POST',
      body: { name: nouveauNom.value, phone: nouveauNumero.value, shares: nouvellesParts.value },
    })
    nouveauNom.value = ''
    nouveauNumero.value = ''
    nouvellesParts.value = 1
    await charger()
  }
  catch (e) {
    erreur.value = message(e)
  }
  finally {
    ajoutEnCours.value = false
  }
}

async function tirerAuSort() {
  erreur.value = null
  try {
    await $fetch(`/api/v1/tontines/${tontineId}/rotation`, {
      method: 'POST',
      body: { mode: 'draw' },
    })
    await charger()
  }
  catch (e) {
    erreur.value = message(e)
  }
}

async function demarrer() {
  erreur.value = null
  try {
    await $fetch(`/api/v1/tontines/${tontineId}/start`, { method: 'POST' })
    await charger()
  }
  catch (e) {
    erreur.value = message(e)
  }
}

onMounted(charger)
useEnTete(() => ({
  titre: 'Membres',
  retour: { to: '/app', label: 'Mes tontines' },
}))
useHead({ title: 'Membres — eTontine' })
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

    <template v-else>
      <!-- Liste de cartes empilées : jamais de DataTable sous `md` (règle 11). -->
      <EmptyState
        v-if="membres.length === 0"
        title="Aucun membre pour l’instant"
        description="Ajoute les membres de ta tontine, ou envoie-leur le lien d’invitation."
        icon="lucide:users"
      />

      <ul
        v-else
        class="flex flex-col gap-2"
        data-testid="liste-membres"
      >
        <li
          v-for="membre in membres"
          :key="membre.id"
          class="card-surface flex items-start gap-3 p-3"
          :data-testid="`membre-${membre.id}`"
        >
          <!-- Le rang dans la rotation, en pastille — repris de la liste de
               membres du template. Il répond à la question que le membre pose
               en premier : « je passe quand ? ». Un double part affiche ses
               deux positions, séparées par une barre. -->
          <span
            class="tabular flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-surface text-xs font-bold text-brand-strong"
            aria-hidden="true"
          >{{ membre.positions.length > 0 ? membre.positions.join('/') : '—' }}</span>

          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <span class="truncate font-semibold text-ink">
              {{ membre.name ?? 'Membre inscrit' }}
            </span>
            <span
              v-if="membre.phone"
              class="tabular truncate text-sm text-ink-muted"
            >{{ membre.phone }}</span>

            <!-- Un double part occupe deux positions distinctes : on les montre
                 toutes les deux, c'est ce que le bureau vient vérifier. -->
            <span
              class="text-sm text-ink-muted"
              :data-testid="`parts-${membre.id}`"
            >
              {{ membre.shares }} part{{ membre.shares > 1 ? 's' : '' }}
              <template v-if="membre.positions.length > 0">
                · position{{ membre.positions.length > 1 ? 's' : '' }}
                {{ membre.positions.join(' et ') }}
              </template>
            </span>
          </div>

          <StatusBadge
            kind="membership"
            :status="membre.status"
            compact
          />
        </li>
      </ul>

      <p
        v-if="tontine"
        class="text-sm text-ink-muted"
        data-testid="total-parts"
      >
        {{ tontine.totalShares }} parts au total · pot attendu par tour :
        <AmountDisplay :amount="tontine.expectedPot" />
      </p>

      <!-- Demandes d'adhésion arrivées par lien -->
      <section
        v-if="estPresident && enAttente.length > 0"
        class="flex flex-col gap-3 card-surface p-4"
        data-testid="section-adhesions"
      >
        <h2 class="font-semibold text-ink">
          Demandes d’adhésion
        </h2>
        <p class="text-sm text-ink-muted">
          Ces personnes ont ouvert ton lien d’invitation. Tant que tu n’as pas
          donné ton accord, elles ne cotisent pas et ne prennent pas la main.
        </p>

        <ul class="flex flex-col gap-3">
          <li
            v-for="membre in enAttente"
            :key="membre.id"
            class="flex flex-col gap-2 rounded-control border border-line p-3"
            :data-testid="`adhesion-${membre.id}`"
          >
            <span class="font-semibold text-ink">
              {{ membre.name ?? 'Membre inscrit' }}
            </span>
            <span
              v-if="membre.phone"
              class="tabular text-sm text-ink-muted"
            >{{ membre.phone }}</span>

            <label
              class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
              :for="`parts-adhesion-${membre.id}`"
            >
              Nombre de parts
              <InputText
                :id="`parts-adhesion-${membre.id}`"
                :value="partsDe(membre.id)"
                inputmode="numeric"
                :data-testid="`champ-parts-adhesion-${membre.id}`"
                @input="partsApprobation[membre.id]
                  = Number(($event.target as HTMLInputElement).value.replace(/\D/g, '')) || 1"
              />
            </label>

            <div class="flex flex-col gap-2 sm:flex-row">
              <Button
                :label="decisionEnCours === membre.id ? 'Enregistrement…' : 'Approuver'"
                :disabled="decisionEnCours !== null"
                class="bg-brand text-brand-ink hover:bg-brand-strong sm:flex-1"
                :data-testid="`bouton-approuver-${membre.id}`"
                @click="decider(membre.id, 'active')"
              />
              <Button
                label="Refuser"
                :disabled="decisionEnCours !== null"
                class="border border-line-strong bg-surface text-ink hover:bg-surface-muted sm:flex-1"
                :data-testid="`bouton-refuser-${membre.id}`"
                @click="decider(membre.id, 'left')"
              />
            </div>
          </li>
        </ul>
      </section>

      <!-- Ajout d'un membre géré -->
      <section
        v-if="estPresident && tontine?.status !== 'running'"
        class="flex flex-col gap-3 card-surface p-4"
      >
        <h2 class="font-semibold text-ink">
          Ajouter un membre
        </h2>
        <p class="text-sm text-ink-muted">
          Pour quelqu’un qui n’a pas encore l’application. Il recevra un SMS de
          confirmation.
        </p>

        <label
          class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
          for="nom-membre"
        >
          Nom
          <InputText
            id="nom-membre"
            v-model="nouveauNom"
            data-testid="champ-nom-membre"
          />
        </label>
        <label
          class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
          for="numero-membre"
        >
          Numéro
          <InputText
            id="numero-membre"
            v-model="nouveauNumero"
            inputmode="tel"
            placeholder="07 07 12 34 56"
            data-testid="champ-numero-membre"
          />
        </label>
        <label
          class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
          for="parts-membre"
        >
          Nombre de parts
          <InputText
            id="parts-membre"
            :value="nouvellesParts"
            inputmode="numeric"
            data-testid="champ-parts-membre"
            @input="nouvellesParts = Number(($event.target as HTMLInputElement).value.replace(/\D/g, '')) || 1"
          />
          <span class="text-sm font-normal text-ink-subtle">
            Deux parts = deux positions dans la rotation, deux cotisations par
            tour, et deux fois où il prend la main.
          </span>
        </label>

        <Button
          :label="ajoutEnCours ? 'Ajout…' : 'Ajouter'"
          :disabled="ajoutEnCours || nouveauNom.length < 3 || nouveauNumero.length < 8"
          class="bg-brand text-brand-ink hover:bg-brand-strong"
          data-testid="bouton-ajouter-membre"
          @click="ajouter"
        />
      </section>

      <!-- Invitation -->
      <section
        v-if="estPresident"
        class="flex flex-col gap-3 card-surface p-4"
      >
        <h2 class="font-semibold text-ink">
          Inviter
        </h2>

        <Button
          v-if="!invitation"
          label="Créer un lien d’invitation"
          class="border border-line-strong bg-surface text-ink hover:bg-surface-muted"
          data-testid="bouton-creer-lien"
          @click="creerLien"
        />

        <PartageInvitation
          v-else
          :url="invitation.url"
          :tontine-name="tontine?.name ?? ''"
          :engagement="engagement"
          :qr-url="`/api/v1/tontines/${tontineId}/invites/${invitation.token}/qr`"
        />
      </section>

      <p
        v-if="erreur"
        role="alert"
        class="rounded-control bg-disputed-surface p-3 text-sm text-disputed-ink"
        data-testid="erreur-membres"
      >
        {{ erreur }}
      </p>

      <div
        v-if="estPresident && tontine?.status === 'open'"
        class="mt-auto flex flex-col gap-2 pt-2"
      >
        <Button
          label="Tirer l’ordre au sort"
          class="border border-line-strong bg-surface text-ink hover:bg-surface-muted"
          data-testid="bouton-tirage"
          @click="tirerAuSort"
        />
        <Button
          label="Démarrer la tontine"
          :disabled="!peutDemarrer"
          class="bg-brand text-brand-ink hover:bg-brand-strong"
          data-testid="bouton-demarrer"
          @click="demarrer"
        />
        <p class="text-sm text-ink-subtle">
          Au démarrage, l’ordre de passage est figé et tous les tours sont créés.
        </p>
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
