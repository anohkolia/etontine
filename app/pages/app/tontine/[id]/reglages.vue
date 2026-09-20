<script setup lang="ts">
import type { TontineEmoji } from '#shared/constants/tontine'
import { TONTINE_EMOJIS } from '#shared/constants/tontine'
import { tontineDraftInput, tontineFinanceInput, tontineRulesInput } from '#shared/schemas'

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
const { t } = useI18n()

const route = useRoute()
const tontineId = route.params.id as string
const { format } = useMoney()
const { formatDate } = useDate()

interface Canal {
  id: string
  provider: 'wave' | 'orange' | 'mtn' | 'moov'
  msisdn: string
  holderName: string
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
  startDate: string
  penaltyAmount: number
  penaltyPeriod: 'once' | 'per_day'
  graceDays: number
  counterValidationThreshold: number
  myRole: 'president' | 'treasurer' | 'auditor' | 'member'
  channels: Canal[]
}

const FREQUENCE: Record<Detail['frequency'], string> = {
  daily: t('tontine.reglages.journaliere'),
  weekly: t('tontine.reglages.hebdomadaire'),
  biweekly: t('tontine.reglages.tous_les_quinze_jours'),
  monthly: t('tontine.reglages.mensuelle'),
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
  // Réglages d'argent : modifiables tant que la tontine n'a pas démarré.
  shareAmount: 0,
  frequency: 'monthly' as Detail['frequency'],
  startDate: '',
  penaltyAmount: 0,
  penaltyPeriod: 'once' as 'once' | 'per_day',
  graceDays: 0,
  counterValidationThreshold: 0,
})

const EMOJIS = TONTINE_EMOJIS

/** Tous les canaux du compte : il n'y a plus de vérification par SMS qui en écarterait. */
const canauxVerifies = computed(() => mesCanaux.value)
const lancee = computed(() => tontine.value?.status === 'running')

/**
 * La date du premier tour se change ici jusqu'au démarrage. Elle n'était
 * modifiable nulle part : fixée au brouillon, elle était souvent déjà passée
 * quand le groupe était enfin au complet, et le tour 1 naissait en retard.
 */
const aujourdhui = new Date().toISOString().slice(0, 10)
const dateValide = computed(() => /^\d{4}-\d{2}-\d{2}$/.test(form.startDate) && form.startDate >= aujourdhui)

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
    ?? t('commun.serveur_injoignable')
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
      shareAmount: detail.shareAmount,
      frequency: detail.frequency,
      startDate: detail.startDate,
      penaltyAmount: detail.penaltyAmount,
      penaltyPeriod: detail.penaltyPeriod,
      graceDays: detail.graceDays,
      counterValidationThreshold: detail.counterValidationThreshold,
    })
    etat.value = 'contenu'
  }
  catch (e) {
    erreur.value = message(e)
    etat.value = 'erreur'
  }
}

/**
 * Les mêmes schémas que le serveur, appliqués avant l'envoi : le nom, les
 * réglages d'argent et les règles d'amende. L'erreur s'affiche sous le champ.
 */
const validationInfos = useFormulaire(tontineDraftInput.pick({ name: true, description: true, locality: true }))
const validationArgent = useFormulaire(tontineFinanceInput.pick({ shareAmount: true, frequency: true }))
// Sans le plafond, que cet écran n'édite pas : le raffinement « une amende
// journalière a un plafond » est celui du wizard, où le plafond se saisit.
const validationRegles = useFormulaire(tontineRulesInput.innerType().pick({ penaltyAmount: true, penaltyPeriod: true, graceDays: true }))

async function reglagesValides(): Promise<boolean> {
  validationInfos.setValues({
    name: form.name, description: form.description || undefined, locality: form.locality || undefined,
  }, false)
  if ((await validationInfos.valider()) === null) return false
  if (lancee.value) return true

  validationArgent.setValues({ shareAmount: form.shareAmount, frequency: form.frequency }, false)
  validationRegles.setValues({
    penaltyAmount: form.penaltyAmount, penaltyPeriod: form.penaltyPeriod, graceDays: form.graceDays,
  }, false)
  const [argent, regles] = await Promise.all([validationArgent.valider(), validationRegles.valider()])
  return argent !== null && regles !== null
}

async function enregistrer() {
  erreur.value = null
  succes.value = null
  if (!(await reglagesValides())) return
  enCours.value = true
  try {
    const corps: Record<string, unknown> = {
      emoji: form.emoji,
      locality: form.locality.trim() || null,
      description: form.description.trim() || null,
    }
    if (nomModifiable.value) corps.name = form.name.trim()
    if (canalChange.value) corps.collectionChannelIds = form.collectionChannelIds

    // Tant que rien n'a démarré, l'argent se règle ici. Après, le serveur
    // refuse — et l'écran ne propose plus les champs.
    if (!lancee.value) {
      Object.assign(corps, {
        shareAmount: form.shareAmount,
        frequency: form.frequency,
        startDate: form.startDate,
        penaltyAmount: form.penaltyAmount,
        penaltyPeriod: form.penaltyPeriod,
        graceDays: form.graceDays,
        counterValidationThreshold: form.counterValidationThreshold,
      })
    }

    await $fetch(`/api/v1/tontines/${tontineId}`, { method: 'PATCH', body: corps })
    succes.value = canalChange.value
      ? t('tontine.reglages.reglages_enregistres_tous_les')
      : t('tontine.reglages.reglages_enregistres')
    await charger()
  }
  catch (e) {
    erreur.value = message(e)
  }
  finally {
    enCours.value = false
  }
}

/**
 * Fin de vie d'une tontine, selon son état.
 *
 * Aucun de ces trois gestes n'existait : une tontine publiée qui ne démarrait
 * jamais gardait sa place au quota pour toujours, un brouillon créé par erreur
 * restait dans la base, et un cycle fini s'affichait à l'accueil sans fin.
 */
const finOuverte = ref(false)
const finEnCours = ref(false)
const motifAnnulation = ref('')

// Types de retour explicites : sans eux, l'inférence des routes typées de
// Nuxt part en récursion infinie sur ces adresses à segment dynamique.
async function finDeVie(chemin: string, method: 'POST' | 'DELETE', body?: Record<string, unknown>) {
  erreur.value = null
  finEnCours.value = true
  try {
    await $fetch<{ ok: true }>(chemin, { method, body })
    await navigateTo('/app')
  }
  catch (e) {
    erreur.value = message(e)
  }
  finally {
    finEnCours.value = false
  }
}

function supprimerBrouillon() {
  return finDeVie(`/api/v1/tontines/${tontineId}`, 'DELETE')
}

function annulerTontine() {
  return finDeVie(`/api/v1/tontines/${tontineId}/cancel`, 'POST', { reason: motifAnnulation.value.trim() })
}

function archiverTontine() {
  return finDeVie(`/api/v1/tontines/${tontineId}/archive`, 'POST')
}

onMounted(charger)

useEnTete(() => ({
  titre: t('tontine.reglages.reglages'),
  sousTitre: tontine.value?.name,
  retour: { to: `/app/tontine/${tontineId}`, label: t('commun.retour_tontine') },
}))
useHead({ title: t('tontine.reglages.reglages_etontine') })
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

    <EmptyState
      v-else-if="etat === 'refus'"
      :title="$t('tontine.reglages.reserve_au_president')"
      :description="$t('tontine.reglages.seul_le_president_modifie')"
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
          {{ $t('tontine.reglages.presentation') }}
        </h2>

        <label
          class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
          for="nom-tontine"
        >
          {{ $t('tontine.reglages.nom') }}
          <InputText
            id="nom-tontine"
            v-model="form.name"
            :disabled="!nomModifiable"
            data-testid="champ-nom"
          />
          <ErreurChamp :message="validationInfos.erreur('name')" />
          <span
            v-if="!nomModifiable"
            class="text-sm font-normal text-ink-subtle"
          >
            {{ $t('tontine.reglages.le_nom_est_fige') }}
          </span>
        </label>

        <fieldset class="flex flex-col gap-2">
          <legend class="pb-1 text-sm font-medium text-ink-muted">
            {{ $t('tontine.reglages.image') }}
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
          {{ $t('tontine.reglages.quartier_ou_lieu') }}
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
          {{ $t('tontine.reglages.description') }}
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
          {{ $t('tontine.reglages.numero_de_collecte') }}
        </h2>
        <p class="text-sm text-ink-muted">
          {{ $t('tontine.reglages.c_est_la_que') }}
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
          {{ $t('tontine.reglages.ce_numero_a_change', { p0: formatDate(gelEnCours.frozenUntil!) }) }}
        </p>

        <EmptyState
          v-if="canauxVerifies.length === 0"
          :title="$t('tontine.reglages.aucun_numero_verifie')"
          :description="$t('tontine.reglages.ajoute_et_verifie_un')"
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
              {{ $t('tontine.reglages.ajouter_un_numero') }}
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
            {{ $t('tontine.reglages.ajouter_un_autre_numero') }}
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
            <strong class="font-semibold">{{ $t('tontine.reglages.tu_changes_le_numero') }}</strong>
            {{ $t('tontine.reglages.tous_les_membres_seront') }}
          </span>
        </p>
      </section>

      <!-- Réglages d'argent : lecture seule une fois la tontine lancée. -->
      <section class="card-surface flex flex-col gap-3 p-4">
        <h2 class="font-semibold text-ink">
          {{ $t('tontine.reglages.argent_et_regles') }}
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
          {{ $t('tontine.reglages.ces_reglages_sont_figes') }}
        </p>

        <!-- Avant le démarrage, ces réglages s'éditent ici. C'était le trou :
             ils n'étaient modifiables nulle part une fois le wizard quitté, et
             le seuil de contre-validation n'était exposé par aucun écran — il
             restait à sa valeur par défaut pour la vie de la tontine. -->
        <div
          v-if="!lancee"
          class="flex flex-col gap-4"
          data-testid="reglages-argent"
        >
          <label
            class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
            for="montant-part"
          >
            {{ $t('tontine.reglages.montant_d_une_part') }}
            <InputText
              id="montant-part"
              :value="form.shareAmount"
              inputmode="numeric"
              data-testid="champ-montant-part"
              @input="form.shareAmount = Number(($event.target as HTMLInputElement).value.replace(/\D/g, '')) || 0"
            />
            <ErreurChamp :message="validationArgent.erreur('shareAmount')" />
          </label>

          <label
            class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
            for="frequence"
          >
            {{ $t('tontine.reglages.frequence') }}
            <select
              id="frequence"
              v-model="form.frequency"
              class="min-h-touch rounded-control border border-line-strong bg-surface px-3 text-ink"
              data-testid="champ-frequence"
            >
              <option
                v-for="(libelle, valeur) in FREQUENCE"
                :key="valeur"
                :value="valeur"
              >
                {{ libelle }}
              </option>
            </select>
          </label>

          <label
            class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
            for="date-demarrage"
          >
            {{ $t('tontine.reglages.date_du_premier_tour') }}
            <input
              id="date-demarrage"
              v-model="form.startDate"
              type="date"
              :min="aujourdhui"
              class="min-h-touch rounded-control border border-line-strong bg-surface px-3 text-ink"
              data-testid="champ-date-demarrage"
            >
            <span class="text-sm font-normal text-ink-subtle">
              {{ $t('tontine.reglages.toutes_les_echeances_en') }}
            </span>
            <span
              v-if="!dateValide"
              class="text-sm font-normal text-disputed-ink"
              role="alert"
              data-testid="erreur-date-demarrage"
            >
              {{ $t('tontine.reglages.la_date_ne_peut') }}
            </span>
          </label>

          <label
            class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
            for="amende"
          >
            {{ $t('tontine.reglages.amende_de_retard_fcfa') }}
            <InputText
              id="amende"
              :value="form.penaltyAmount"
              inputmode="numeric"
              data-testid="champ-amende"
              @input="form.penaltyAmount = Number(($event.target as HTMLInputElement).value.replace(/\D/g, '')) || 0"
            />
          </label>

          <label
            class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
            for="periode-amende"
          >
            {{ $t('tontine.reglages.comment_elle_s_applique') }}
            <select
              id="periode-amende"
              v-model="form.penaltyPeriod"
              class="min-h-touch rounded-control border border-line-strong bg-surface px-3 text-ink"
              data-testid="champ-periode-amende"
            >
              <option value="once">
                {{ $t('tontine.reglages.une_seule_fois') }}
              </option>
              <option value="per_day">
                {{ $t('tontine.reglages.par_jour_de_retard') }}
              </option>
            </select>
          </label>

          <label
            class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
            for="delai-grace"
          >
            {{ $t('tontine.reglages.delai_de_grace_jours') }}
            <InputText
              id="delai-grace"
              :value="form.graceDays"
              inputmode="numeric"
              data-testid="champ-delai-grace"
              @input="form.graceDays = Number(($event.target as HTMLInputElement).value.replace(/\D/g, '')) || 0"
            />
            <ErreurChamp :message="validationRegles.erreur('graceDays')" />
            <span class="text-sm font-normal text-ink-subtle">
              {{ $t('tontine.reglages.marquer_quelqu_un_en') }}
            </span>
          </label>

          <label
            class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
            for="seuil-contre-validation"
          >
            {{ $t('tontine.reglages.contre_validation_au_dela') }}
            <InputText
              id="seuil-contre-validation"
              :value="form.counterValidationThreshold"
              inputmode="numeric"
              data-testid="champ-seuil"
              @input="form.counterValidationThreshold = Number(($event.target as HTMLInputElement).value.replace(/\D/g, '')) || 0"
            />
            <span class="text-sm font-normal text-ink-subtle">
              {{ $t('tontine.reglages.au_dessus_de_ce') }}
            </span>
          </label>
        </div>

        <dl
          v-else
          class="flex flex-col gap-2 text-sm"
        >
          <div class="flex justify-between gap-3">
            <dt class="text-ink-muted">
              {{ $t('tontine.reglages.montant_d_une_part_2') }}
            </dt>
            <dd class="amount font-medium text-ink">
              {{ format(tontine.shareAmount) }}
            </dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-ink-muted">
              {{ $t('tontine.reglages.frequence') }}
            </dt>
            <dd class="font-medium text-ink">
              {{ FREQUENCE[tontine.frequency] }}
            </dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-ink-muted">
              {{ $t('tontine.reglages.amende') }}
            </dt>
            <dd class="font-medium text-ink">
              <template v-if="tontine.penaltyAmount > 0">
                {{ format(tontine.penaltyAmount) }}
                {{ tontine.penaltyPeriod === 'per_day' ? $t('tontine.reglages.par_jour') : $t('tontine.reglages.une_fois') }}
              </template>
              <template v-else>
                {{ $t('tontine.reglages.aucune') }}
              </template>
            </dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-ink-muted">
              {{ $t('tontine.reglages.delai_de_grace') }}
            </dt>
            <dd class="tabular font-medium text-ink">
              {{ $t('tontine.reglages.p0_jour_p1', { p0: tontine.graceDays, p1: tontine.graceDays > 1 ? 's' : '' }) }}
            </dd>
          </div>
        </dl>

        <!-- Le lien ne vaut que pour un brouillon, et il emporte
             l'identifiant : sans lui, le wizard reprenait ce que le navigateur
             avait gardé — donc rien après une publication — et ouvrait une
             **seconde** tontine au lieu de modifier celle-ci. -->
        <NuxtLink
          v-if="tontine.status === 'draft'"
          :to="`/app/tontine/create?id=${tontineId}`"
          class="min-h-touch inline-flex items-center justify-center rounded-control border border-line-strong bg-surface px-5 text-sm font-semibold text-ink"
          data-testid="lien-configurer"
        >
          {{ $t('tontine.reglages.reprendre_le_wizard') }}
        </NuxtLink>
      </section>

      <!-- Règle 13 : l'action primaire est en bas d'écran. -->
      <Button
        :label="enCours ? $t('tontine.reglages.enregistrement') : $t('tontine.reglages.enregistrer')"
        :disabled="enCours || (!lancee && !dateValide)"
        class="w-full bg-brand text-brand-ink hover:bg-brand-strong"
        data-testid="bouton-enregistrer-reglages"
        @click="enregistrer"
      />

      <!-- Fin de vie. Chaque état a sa sortie, et une seule : un brouillon se
           supprime, une tontine publiée s'annule, une tontine terminée
           s'archive. Une tontine en cours n'a pas de sortie — elle va au bout
           de son cycle, et l'écran le dit plutôt que de cacher la section. -->
      <section
        class="flex flex-col gap-3 rounded-card border border-disputed-ink/20 p-4"
        data-testid="zone-fin-de-vie"
      >
        <h2 class="font-semibold text-ink">
          {{ tontine.status === 'draft' ? $t('tontine.reglages.supprimer_ce_brouillon')
            : tontine.status === 'open' ? $t('tontine.reglages.annuler_cette_tontine')
              : tontine.status === 'closed' ? $t('tontine.reglages.archiver_cette_tontine')
                : $t('tontine.reglages.fin_de_la_tontine') }}
        </h2>

        <template v-if="tontine.status === 'draft'">
          <p class="text-sm text-ink-muted">
            {{ $t('tontine.reglages.personne_ne_l_a') }}
          </p>
          <Button
            :label="finOuverte ? $t('commun.annuler') : $t('tontine.reglages.supprimer_le_brouillon')"
            class="border border-line-strong bg-surface text-ink hover:bg-surface-muted"
            data-testid="bouton-supprimer-brouillon"
            @click="finOuverte = !finOuverte"
          />
          <Button
            v-if="finOuverte"
            :label="finEnCours ? $t('tontine.reglages.suppression') : $t('commun.oui_supprimer')"
            :disabled="finEnCours"
            class="bg-disputed-ink text-surface"
            data-testid="bouton-confirmer-suppression"
            @click="supprimerBrouillon"
          />
        </template>

        <template v-else-if="tontine.status === 'open'">
          <p class="text-sm text-ink-muted">
            {{ $t('tontine.reglages.la_tontine_n_a') }}
          </p>
          <Button
            :label="finOuverte ? $t('commun.annuler') : $t('tontine.reglages.annuler_la_tontine')"
            class="border border-line-strong bg-surface text-ink hover:bg-surface-muted"
            data-testid="bouton-annuler-tontine"
            @click="finOuverte = !finOuverte"
          />
          <template v-if="finOuverte">
            <label
              class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
              for="motif-annulation"
            >
              {{ $t('tontine.reglages.motif_pour_les_membres') }}
              <InputText
                id="motif-annulation"
                v-model="motifAnnulation"
                :placeholder="$t('tontine.reglages.le_groupe_ne_s')"
                data-testid="champ-motif-annulation"
              />
            </label>
            <Button
              :label="finEnCours ? $t('tontine.reglages.annulation') : $t('tontine.reglages.confirmer_l_annulation')"
              :disabled="finEnCours || motifAnnulation.trim().length < 5"
              class="bg-disputed-ink text-surface"
              data-testid="bouton-confirmer-annulation"
              @click="annulerTontine"
            />
          </template>
        </template>

        <template v-else-if="tontine.status === 'closed'">
          <p class="text-sm text-ink-muted">
            {{ $t('tontine.reglages.le_cycle_est_fini') }}
          </p>
          <Button
            :label="finEnCours ? $t('tontine.reglages.archivage') : $t('tontine.reglages.archiver')"
            :disabled="finEnCours"
            class="border border-line-strong bg-surface text-ink hover:bg-surface-muted"
            data-testid="bouton-archiver"
            @click="archiverTontine"
          />
        </template>

        <p
          v-else-if="tontine.status === 'running'"
          class="text-sm text-ink-muted"
          data-testid="fin-impossible"
        >
          {{ $t('tontine.reglages.une_tontine_en_cours') }}
        </p>

        <p
          v-else
          class="text-sm text-ink-muted"
        >
          {{ $t('tontine.reglages.cette_tontine_est_archivee') }}
        </p>
      </section>
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
