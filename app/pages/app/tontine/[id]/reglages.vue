<script setup lang="ts">
import type { TontineEmoji } from '#shared/constants/tontine'
import { TONTINE_EMOJIS } from '#shared/constants/tontine'

/**
 * Réglages d'une tontine — président.
 *
 * L'écran manquait, et son absence laissait un lien mort : à chaque changement
 * de canal de collecte, `server/services/canaux.ts` notifie tous les membres
 * vers `/app/tontine/:id/reglages`. La notification existait, la page non.
 *
 * Plus grave, la règle 22 — re-vérification OTP, notification à tous les
 * membres, gel de 48 h à chaque changement de canal — était implémentée et
 * testée côté serveur sans qu'aucune interface puisse la déclencher.
 *
 * **Le rôle vient du serveur.** `PATCH /tontines/:id` exige déjà le président
 * (`requireMembership(..., ['president'])`) ; ce que fait cet écran, c'est ne
 * pas proposer un formulaire qui serait refusé. Le magasin de session reste un
 * cache d'affichage (règle 12).
 *
 * **Ce qui touche à l'argent se fige au démarrage.** Montant d'une part,
 * fréquence, amendes : modifiables tant que la tontine est un brouillon, en
 * lecture seule ensuite — les changer réécrirait des dus déjà calculés, et
 * pour certains déjà versés. L'écran le dit au lieu de griser en silence.
 */
definePageMeta({ layout: 'app', middleware: 'auth' })

const route = useRoute()
const tontineId = route.params.id as string
const { format } = useMoney()
const { formatDate } = useDate()

interface Canal {
  id: string
  provider: 'wave' | 'orange' | 'mtn' | 'moov'
  msisdn: string
  holderName: string
  verifiedAt?: string | null
  frozenUntil?: string | null
}

interface Detail {
  id: string
  name: string
  emoji: string | null
  description: string | null
  locality: string | null
  status: 'draft' | 'open' | 'running' | 'closed' | 'archived'
  shareAmount: number
  frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly'
  penaltyAmount: number
  penaltyPeriod: 'once' | 'per_day'
  graceDays: number
  myRole: 'president' | 'treasurer' | 'auditor' | 'member'
  channels: Canal[]
}

const FREQUENCE: Record<Detail['frequency'], string> = {
  daily: 'Journalière',
  weekly: 'Hebdomadaire',
  biweekly: 'Tous les quinze jours',
  monthly: 'Mensuelle',
}

const etat = ref<'chargement' | 'contenu' | 'erreur' | 'refus'>('chargement')
const tontine = ref<Detail | null>(null)
const mesCanaux = ref<Canal[]>([])
const erreur = ref<string | null>(null)
const succes = ref<string | null>(null)
const enCours = ref(false)

const form = reactive({
  name: '',
  emoji: null as TontineEmoji | null,
  locality: '',
  description: '',
  collectionChannelIds: [] as string[],
})

const EMOJIS = TONTINE_EMOJIS

const canauxVerifies = computed(() => mesCanaux.value.filter(c => c.verifiedAt))
const lancee = computed(() => tontine.value?.status === 'running')

/** Le nom est un réglage de présentation, sauf qu'il figure dans les invitations. */
const nomModifiable = computed(() => tontine.value?.status === 'draft')

/**
 * Le changement de canal est-il en train de se produire ?
 *
 * On compare la sélection à ce qui est rattaché aujourd'hui. C'est ce qui
 * déclenche l'avertissement : il faut le montrer **avant** de valider, pas
 * après, quand les 48 h de gel courent déjà.
 */
const canalChange = computed(() => {
  if (!tontine.value) return false
  const actuels = new Set(tontine.value.channels.map(c => c.id))
  const choisis = new Set(form.collectionChannelIds)
  if (actuels.size !== choisis.size) return true
  return [...choisis].some(id => !actuels.has(id))
})

/** Un canal rattaché récemment est gelé : on le dit, avec la date de fin. */
const gelEnCours = computed(() =>
  tontine.value?.channels.find(c => c.frozenUntil && new Date(c.frozenUntil) > new Date()) ?? null,
)

function message(e: unknown): string {
  return (e as { data?: { error?: { message?: string } } })?.data?.error?.message
    ?? 'Impossible de joindre le serveur.'
}

async function charger() {
  etat.value = 'chargement'
  try {
    const [detail, canaux] = await Promise.all([
      $fetch<Detail>(`/api/v1/tontines/${tontineId}`),
      $fetch<Canal[]>('/api/v1/me/channels'),
    ])

    // Le serveur refusera de toute façon ; on évite d'afficher un formulaire
    // qui ne peut qu'échouer.
    if (detail.myRole !== 'president') {
      tontine.value = detail
      etat.value = 'refus'
      return
    }

    tontine.value = detail
    mesCanaux.value = canaux
    Object.assign(form, {
      name: detail.name,
      emoji: (detail.emoji as TontineEmoji | null) ?? null,
      locality: detail.locality ?? '',
      description: detail.description ?? '',
      collectionChannelIds: detail.channels.map(c => c.id),
    })
    etat.value = 'contenu'
  }
  catch (e) {
    erreur.value = message(e)
    etat.value = 'erreur'
  }
}

async function enregistrer() {
  erreur.value = null
  succes.value = null
  enCours.value = true
  try {
    const corps: Record<string, unknown> = {
      emoji: form.emoji,
      locality: form.locality.trim() || null,
      description: form.description.trim() || null,
    }
    if (nomModifiable.value) corps.name = form.name.trim()
    if (canalChange.value) corps.collectionChannelIds = form.collectionChannelIds

    await $fetch(`/api/v1/tontines/${tontineId}`, { method: 'PATCH', body: corps })
    succes.value = canalChange.value
      ? 'Réglages enregistrés. Tous les membres viennent d’être prévenus du changement de numéro.'
      : 'Réglages enregistrés.'
    await charger()
  }
  catch (e) {
    erreur.value = message(e)
  }
  finally {
    enCours.value = false
  }
}

onMounted(charger)

useEnTete(() => ({
  titre: 'Réglages',
  sousTitre: tontine.value?.name,
  retour: { to: `/app/tontine/${tontineId}`, label: 'La tontine' },
}))
useHead({ title: 'Réglages — eTontine' })
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

    <EmptyState
      v-else-if="etat === 'refus'"
      title="Réservé au président"
      description="Seul le président modifie les réglages d’une tontine. Le bureau peut confirmer les cotisations et verser le pot."
      icon="lucide:lock"
      data-testid="refus-reglages"
    />

    <template v-else-if="tontine">
      <p
        v-if="succes"
        role="status"
        class="flex items-start gap-2 rounded-control bg-confirmed-surface p-3 text-sm text-confirmed-ink"
        data-testid="reglages-enregistres"
      >
        <Icon
          name="lucide:circle-check"
          size="1rem"
          class="mt-0.5 shrink-0"
          aria-hidden="true"
        />
        {{ succes }}
      </p>

      <p
        v-if="erreur"
        role="alert"
        class="flex items-start gap-2 rounded-control bg-disputed-surface p-3 text-sm text-disputed-ink"
        data-testid="erreur-reglages"
      >
        <Icon
          name="lucide:octagon-alert"
          size="1rem"
          class="mt-0.5 shrink-0"
          aria-hidden="true"
        />
        {{ erreur }}
      </p>

      <!-- Présentation : modifiable à tout moment, y compris tontine lancée.
           Rien ici ne touche à un montant ni à un statut. -->
      <section class="card-surface flex flex-col gap-4 p-4">
        <h2 class="font-semibold text-ink">
          Présentation
        </h2>

        <label
          class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
          for="nom-tontine"
        >
          Nom
          <InputText
            id="nom-tontine"
            v-model="form.name"
            :disabled="!nomModifiable"
            data-testid="champ-nom"
          />
          <span
            v-if="!nomModifiable"
            class="text-sm font-normal text-ink-subtle"
          >
            Le nom est figé depuis la publication : il figure dans les
            invitations déjà envoyées et sur les reçus déjà émis.
          </span>
        </label>

        <fieldset class="flex flex-col gap-2">
          <legend class="pb-1 text-sm font-medium text-ink-muted">
            Image
          </legend>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="e in EMOJIS"
              :key="e"
              type="button"
              class="card-surface flex size-touch items-center justify-center text-xl transition-shadow"
              :class="form.emoji === e ? 'ring-2 ring-brand' : 'hover:shadow-float'"
              :aria-pressed="form.emoji === e"
              :data-testid="`emoji-${e}`"
              @click="form.emoji = form.emoji === e ? null : e"
            >
              {{ e }}
            </button>
          </div>
        </fieldset>

        <label
          class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
          for="lieu"
        >
          Quartier ou lieu
          <InputText
            id="lieu"
            v-model="form.locality"
            data-testid="champ-lieu"
          />
        </label>

        <label
          class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
          for="description"
        >
          Description
          <InputText
            id="description"
            v-model="form.description"
            data-testid="champ-description"
          />
        </label>
      </section>

      <!-- Canaux de collecte — règle 22. -->
      <section class="card-surface flex flex-col gap-4 p-4">
        <h2 class="font-semibold text-ink">
          Numéro de collecte
        </h2>
        <p class="text-sm text-ink-muted">
          C’est là que tes membres envoient leurs cotisations. Ils y lisent le
          nom du titulaire avant de valider.
        </p>

        <p
          v-if="gelEnCours"
          class="flex items-start gap-2 rounded-control bg-late-surface p-3 text-sm text-late-ink"
          role="status"
          data-testid="gel-en-cours"
        >
          <Icon
            name="lucide:clock"
            size="1rem"
            class="mt-0.5 shrink-0"
            aria-hidden="true"
          />
          Ce numéro a changé récemment. Il reste signalé aux membres jusqu’au
          {{ formatDate(gelEnCours.frozenUntil!) }}.
        </p>

        <EmptyState
          v-if="canauxVerifies.length === 0"
          title="Aucun numéro vérifié"
          description="Ajoute et vérifie un numéro de collecte pour pouvoir le rattacher à cette tontine."
          icon="lucide:smartphone"
        >
          <template #action>
            <NuxtLink
              :to="`/app/profil/canaux?redirect=${encodeURIComponent($route.fullPath)}`"
              class="min-h-touch inline-flex items-center justify-center gap-2 rounded-control bg-brand px-5 font-semibold text-brand-ink"
              data-testid="lien-ajouter-canal"
            >
              <Icon
                name="lucide:plus"
                size="1rem"
                aria-hidden="true"
              />
              Ajouter un numéro
            </NuxtLink>
          </template>
        </EmptyState>

        <template v-else>
          <label
            v-for="canal in canauxVerifies"
            :key="canal.id"
            class="flex min-h-touch items-center gap-3 rounded-control border border-line p-3"
          >
            <input
              v-model="form.collectionChannelIds"
              type="checkbox"
              :value="canal.id"
              class="size-5 shrink-0 accent-brand"
              :data-testid="`canal-${canal.id}`"
            >
            <CanalPill
              :canal="canal.provider"
              compact
            />
            <span class="min-w-0 flex-1 text-sm">
              <span class="block truncate font-medium text-ink">{{ canal.holderName }}</span>
              <span class="tabular block truncate text-ink-muted">{{ canal.msisdn }}</span>
            </span>
          </label>

          <NuxtLink
            :to="`/app/profil/canaux?redirect=${encodeURIComponent($route.fullPath)}`"
            class="min-h-touch inline-flex items-center gap-1.5 text-sm font-semibold text-brand"
            data-testid="lien-ajouter-canal"
          >
            <Icon
              name="lucide:plus"
              size="1rem"
              aria-hidden="true"
            />
            Ajouter un autre numéro
          </NuxtLink>
        </template>

        <!-- Règle 22 : l'avertissement se lit **avant** de valider. Après, les
             48 h de gel courent déjà et tous les membres ont été notifiés. -->
        <p
          v-if="canalChange && lancee"
          class="flex items-start gap-2 rounded-control bg-late-surface p-3 text-sm text-late-ink"
          role="alert"
          data-testid="avertissement-changement-canal"
        >
          <Icon
            name="lucide:triangle-alert"
            size="1rem"
            class="mt-0.5 shrink-0"
            aria-hidden="true"
          />
          <span>
            <strong class="font-semibold">Tu changes le numéro de collecte d’une
              tontine en cours.</strong>
            Tous les membres seront prévenus, le changement sera inscrit au
            registre, et le nouveau numéro restera signalé comme récent pendant
            48 heures. C’est volontaire : c’est le geste que reproduirait
            quelqu’un ayant pris la main sur ton compte.
          </span>
        </p>
      </section>

      <!-- Réglages d'argent : lecture seule une fois la tontine lancée. -->
      <section class="card-surface flex flex-col gap-3 p-4">
        <h2 class="font-semibold text-ink">
          Argent et règles
        </h2>

        <p
          v-if="lancee"
          class="flex items-start gap-2 rounded-control bg-surface-muted p-3 text-sm text-ink-muted"
          data-testid="reglages-figes"
        >
          <Icon
            name="lucide:lock"
            size="1rem"
            class="mt-0.5 shrink-0"
            aria-hidden="true"
          />
          Ces réglages sont figés depuis le démarrage. Les modifier réécrirait
          des cotisations déjà calculées, et pour certaines déjà versées.
        </p>

        <dl class="flex flex-col gap-2 text-sm">
          <div class="flex justify-between gap-3">
            <dt class="text-ink-muted">
              Montant d’une part
            </dt>
            <dd class="amount font-medium text-ink">
              {{ format(tontine.shareAmount) }}
            </dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-ink-muted">
              Fréquence
            </dt>
            <dd class="font-medium text-ink">
              {{ FREQUENCE[tontine.frequency] }}
            </dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-ink-muted">
              Amende
            </dt>
            <dd class="font-medium text-ink">
              <template v-if="tontine.penaltyAmount > 0">
                {{ format(tontine.penaltyAmount) }}
                {{ tontine.penaltyPeriod === 'per_day' ? 'par jour' : 'une fois' }}
              </template>
              <template v-else>
                Aucune
              </template>
            </dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-ink-muted">
              Délai de grâce
            </dt>
            <dd class="tabular font-medium text-ink">
              {{ tontine.graceDays }} jour{{ tontine.graceDays > 1 ? 's' : '' }}
            </dd>
          </div>
        </dl>

        <NuxtLink
          v-if="!lancee"
          to="/app/tontine/create"
          class="min-h-touch inline-flex items-center justify-center rounded-control border border-line-strong bg-surface px-5 text-sm font-semibold text-ink"
          data-testid="lien-configurer"
        >
          Modifier dans le wizard
        </NuxtLink>
      </section>

      <!-- Règle 13 : l'action primaire est en bas d'écran. -->
      <Button
        :label="enCours ? 'Enregistrement…' : 'Enregistrer'"
        :disabled="enCours"
        class="w-full bg-brand text-brand-ink hover:bg-brand-strong"
        data-testid="bouton-enregistrer-reglages"
        @click="enregistrer"
      />
    </template>
  </div>
</template>

<!--
  États d'écran (règle 14) :
  · chargement — LoadingSkeleton
  · vide       — EmptyState pour l'absence de canal vérifié, et pour le refus
                 d'accès (qui n'est pas une erreur : c'est un rôle)
  · erreur     — ErrorState au chargement, message en ligne à l'enregistrement
  · hors-ligne — bandeau porté par `layouts/app.vue`
  · contenu    — le formulaire
-->
