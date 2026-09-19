<script setup lang="ts">
/**
 * Versement du pot : préparation → contre-validation → déclaration → accusé.
 *
 * Le geste le plus lourd de l'application, et celui qui porte le plus de
 * risque. Trois garde-fous s'y enchaînent, chacun pour une raison précise :
 * la ressaisie des quatre derniers chiffres contre l'envoi au mauvais numéro,
 * la contre-validation au-delà du seuil contre le détournement, et l'accusé de
 * réception du bénéficiaire contre le quitus auto-délivré.
 */
import { acknowledgePayoutInput, declarePayoutInput, preparePayoutInput } from '#shared/schemas'

definePageMeta({ layout: 'app', middleware: 'auth' })
const { t } = useI18n()

const route = useRoute()
const tontineId = route.params.id as string
const session = useSessionStore()

interface Manquant { membershipId: string, name: string, remaining: number }
interface EtatVersement {
  roundId: string
  roundIndex: number
  collected: number
  expected: number
  shortfall: number
  missing: Manquant[]
  beneficiary: {
    membershipId: string
    name: string
    msisdn: string | null
    phoneRecentlyChanged: boolean
    /** Sans compte, il ne peut pas accuser réception : personne ne le peut. */
    hasAccount: boolean
  }
  counterValidationRequired: boolean
  counterValidationThreshold: number
  /** Faux quand personne ne peut contre-valider — bureau réduit au préparateur. */
  counterValidationPossible: boolean
  /** Calculé côté serveur pour l'appelant : le client n'en décide pas. */
  canCounterValidate: boolean
  payout: {
    id: string
    status: 'prepared' | 'counter_validated' | 'declared' | 'acknowledged' | 'disputed'
    amount: number
    shortfallAmount: number
    preparedBy: string | null
    counterValidatedBy: string | null
  } | null
}

const etat = ref<'chargement' | 'contenu' | 'erreur' | 'vide'>('chargement')
const versement = ref<EtatVersement | null>(null)
const monRole = ref<string | null>(null)
const erreur = ref<string | null>(null)
const enCours = ref(false)

/**
 * Le versement vient d'être bouclé pendant cette visite.
 *
 * L'accusé de réception clôt le tour : il n'y a plus de « tour courant », et
 * l'écran se viderait. Or c'est précisément le moment où le bénéficiaire a
 * besoin d'une confirmation — il vient de dire qu'il a reçu de l'argent.
 */
const termine = ref(false)

/**
 * Les trois formulaires du versement, chacun validé par le schéma que le
 * serveur applique : quatre chiffres exactement pour préparer, un canal connu
 * pour déclarer, un montant entier et positif pour accuser réception.
 */
const preparation = useFormulaire(preparePayoutInput, { beneficiaryPhoneLast4: '', acceptIncompletePot: false })
const [quatreChiffres, quatreChiffresAttrs] = preparation.champ('beneficiaryPhoneLast4')
const [assumerIncomplet] = preparation.champ('acceptIncompletePot')
const declarationVersement = useFormulaire(declarePayoutInput, { channel: 'wave', providerRef: undefined })
const [canalVersement, canalVersementAttrs] = declarationVersement.champ('channel')
const [referenceVersement, referenceVersementAttrs] = declarationVersement.champ('providerRef')
const accuse = useFormulaire(acknowledgePayoutInput, { receivedAmount: 0 })
const [montantRecu] = accuse.champ('receivedAmount')
const motifCloture = ref('')
/** Le tour vient d'être clos sans accusé : ce n'est pas la même fin. */
const closSansAccuse = ref(false)

/**
 * La capture de l'envoi du pot.
 *
 * L'API l'acceptait depuis le début (`proofUrl`) et le formulaire ne la
 * proposait pas — alors que c'est le plus gros envoi du cycle, et le premier
 * qu'on conteste. Compressée avant l'envoi, comme une preuve de cotisation.
 */
const { compresser } = useCompressionImage()
const preuveVersement = ref<File | null>(null)
const poidsPreuveVersement = ref<number | null>(null)

async function choisirPreuveVersement(evenement: Event) {
  const fichier = (evenement.target as HTMLInputElement).files?.[0]
  if (!fichier) return
  try {
    const compresse = await compresser(fichier)
    preuveVersement.value = compresse
    poidsPreuveVersement.value = compresse.size
  }
  catch (e) {
    erreur.value = (e as Error).message
  }
}

async function preparer() {
  const valeurs = await preparation.valider()
  if (!valeurs) return
  await appeler('prepare', valeurs)
}

async function accuserReception() {
  const valeurs = await accuse.valider()
  if (!valeurs) return
  await appeler('acknowledge', valeurs)
}

async function declarerVersement() {
  erreur.value = null
  if (!referenceVersement.value?.trim()) declarationVersement.setFieldValue('providerRef', undefined, false)
  const valeurs = await declarationVersement.valider()
  if (!valeurs) return
  let proofUrl: string | undefined
  if (preuveVersement.value) {
    enCours.value = true
    try {
      const formulaire = new FormData()
      formulaire.append('file', preuveVersement.value)
      const depot = await $fetch<{ url: string }>('/api/v1/uploads/proof', { method: 'POST', body: formulaire })
      proofUrl = depot.url
    }
    catch (e) {
      erreur.value = message(e)
      enCours.value = false
      return
    }
  }
  await appeler('declare', { ...valeurs, proofUrl })
  preuveVersement.value = null
  poidsPreuveVersement.value = null
}

const estBureau = computed(() => monRole.value === 'president' || monRole.value === 'treasurer')
const estPresident = computed(() => monRole.value === 'president')
/**
 * Le droit de contre-valider est **résolu par le serveur** et lu ici tel quel.
 * Il ne se déduit plus du seul rôle : le bénéficiaire du tour l'a aussi, et le
 * client ne sait pas qui c'est avant de l'avoir demandé.
 */
const peutContreValider = computed(() => versement.value?.canCounterValidate === true)

/** Personne ne peut contre-valider : le versement passe outre, et c'est écrit. */
const contreValidationImpossible = computed(() =>
  versement.value?.counterValidationRequired === true
  && versement.value.counterValidationPossible === false,
)

/** Seul le bénéficiaire peut accuser réception — le serveur refuse les autres. */
const jeSuisBeneficiaire = computed(() =>
  session.memberships.some(m => m.id === versement.value?.beneficiary.membershipId),
)

function message(e: unknown): string {
  return (e as { data?: { error?: { message?: string } } })?.data?.error?.message
    ?? t('commun.serveur_injoignable')
}

async function charger() {
  etat.value = 'chargement'
  try {
    const detail = await $fetch<{ myRole: string, currentRound: { id: string } | null }>(
      `/api/v1/tontines/${tontineId}`,
    )
    monRole.value = detail.myRole

    if (!detail.currentRound) {
      // Sauf si l'on vient de clore le tour : on garde alors l'écran de
      // confirmation plutôt que d'afficher un vide déroutant.
      etat.value = termine.value ? 'contenu' : 'vide'
      return
    }

    versement.value = await $fetch<EtatVersement>(`/api/v1/rounds/${detail.currentRound.id}/payout`)
    accuse.setFieldValue('receivedAmount', versement.value.payout?.amount ?? versement.value.collected, false)
    etat.value = 'contenu'
  }
  catch (e) {
    erreur.value = message(e)
    etat.value = 'erreur'
  }
}

async function appeler(chemin: string, corps?: Record<string, unknown>) {
  erreur.value = null
  enCours.value = true
  try {
    await $fetch(`/api/v1/rounds/${versement.value!.roundId}/payout/${chemin}`, {
      method: 'POST',
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      body: corps ?? {},
    })
    if (chemin === 'acknowledge') termine.value = true
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
 * Clôture forcée : la route ne vit pas sous `payout/`, parce que ce n'est pas
 * une étape du versement. C'est un aveu qu'une étape n'aura pas lieu.
 */
async function clore() {
  erreur.value = null
  enCours.value = true
  try {
    await $fetch(`/api/v1/rounds/${versement.value!.roundId}/close`, {
      method: 'POST',
      body: { reason: motifCloture.value.trim() },
    })
    termine.value = true
    closSansAccuse.value = true
    motifCloture.value = ''
    await charger()
  }
  catch (e) {
    erreur.value = message(e)
  }
  finally {
    enCours.value = false
  }
}

onMounted(async () => {
  await session.charger()
  await charger()
})

useEnTete(() => ({
  titre: t('tontine.versement.verser_le_pot'),
  retour: { to: `/app/tontine/${tontineId}`, label: t('commun.retour_tontine') },
}))
useHead({ title: t('tontine.versement.verser_le_pot_etontine') })
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
      v-else-if="etat === 'vide'"
      :title="$t('tontine.versement.aucun_tour_en_cours')"
      :description="$t('tontine.versement.il_n_y_a')"
      icon="lucide:package"
    />

    <section
      v-else-if="termine && !versement"
      class="flex flex-col gap-2 card-surface p-4"
      data-testid="versement-termine"
    >
      <StatusBadge
        kind="payout"
        status="acknowledged"
      />
      <p class="text-sm text-ink-muted">
        {{ $t('tontine.versement.tu_as_confirme_avoir') }}
      </p>
    </section>

    <template v-else-if="versement">
      <!-- Pot constitué face au pot attendu -->
      <section class="flex flex-col gap-3 card-surface p-4">
        <h2 class="font-semibold text-ink">
          {{ $t('tontine.versement.tour_p0', { p0: versement.roundIndex }) }}
        </h2>

        <div class="flex flex-col gap-1">
          <p class="text-sm text-ink-muted">
            {{ $t('tontine.versement.pot_constitue') }}
          </p>
          <AmountDisplay
            :amount="versement.collected"
            size="xl"
            data-testid="pot-constitue"
          />
          <p class="text-sm text-ink-muted">
            {{ $t('tontine.versement.sur') }} <AmountDisplay
              :amount="versement.expected"
              size="sm"
            /> {{ $t('tontine.versement.attendus') }}
          </p>
        </div>

        <ProgressBar
          :value="Math.round((versement.collected / versement.expected) * 100)"
          :aria-label="$t('tontine.versement.pot_constitue_a', { p0: Math.round((versement.collected / versement.expected) * 100) })"
        />

        <div
          v-if="versement.missing.length > 0"
          class="flex flex-col gap-2 rounded-control bg-late-surface p-3 text-sm text-late-ink"
          data-testid="liste-manquants"
        >
          <p class="flex items-start gap-2 font-medium">
            <Icon
              name="lucide:triangle-alert"
              size="1rem"
              class="mt-0.5 shrink-0"
              aria-hidden="true"
            />
            {{ $t('tontine.versement.p0_cotisation_s_non', { p0: versement.missing.length }) }}
          </p>
          <ul class="flex flex-col gap-1 pl-6">
            <li
              v-for="manquant in versement.missing"
              :key="manquant.membershipId"
              class="list-disc"
            >
              {{ $t('tontine.versement.p0_il_reste', { p0: manquant.name }) }}
              <AmountDisplay
                :amount="manquant.remaining"
                size="sm"
              />
            </li>
          </ul>
        </div>
      </section>

      <!-- Bénéficiaire -->
      <section class="flex flex-col gap-2 card-surface p-4">
        <h2 class="font-semibold text-ink">
          {{ $t('tontine.versement.qui_prend_la_main') }}
        </h2>
        <p
          class="text-lg font-semibold text-ink"
          data-testid="nom-beneficiaire"
        >
          {{ versement.beneficiary.name }}
        </p>
        <p
          v-if="versement.beneficiary.msisdn"
          class="font-mono text-base tabular-nums text-ink-muted"
        >
          {{ versement.beneficiary.msisdn }}
        </p>

        <p
          v-if="versement.beneficiary.phoneRecentlyChanged"
          class="flex items-start gap-2 rounded-control bg-disputed-surface p-3 text-sm text-disputed-ink"
          role="alert"
          data-testid="alerte-numero-change"
        >
          <Icon
            name="lucide:octagon-alert"
            size="1rem"
            class="mt-0.5 shrink-0"
            aria-hidden="true"
          />
          {{ $t('tontine.versement.ce_numero_a_change') }}
        </p>
      </section>

      <p
        v-if="erreur"
        role="alert"
        class="rounded-control bg-disputed-surface p-3 text-sm text-disputed-ink"
        data-testid="erreur-versement"
      >
        {{ erreur }}
      </p>

      <!-- Étape 1 — préparation -->
      <section
        v-if="!versement.payout && estBureau"
        class="flex flex-col gap-3 card-surface p-4"
        data-testid="etape-preparation"
      >
        <h2 class="font-semibold text-ink">
          {{ $t('tontine.versement.preparer_le_versement') }}
        </h2>

        <label
          class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
          for="quatre-chiffres"
        >
          {{ $t('tontine.versement.les_quatre_derniers_chiffres') }}
          <InputText
            id="quatre-chiffres"
            v-model="quatreChiffres"
            v-bind="quatreChiffresAttrs"
            inputmode="numeric"
            maxlength="4"
            class="text-xl tracking-widest tabular-nums"
            :aria-invalid="Boolean(preparation.erreur('beneficiaryPhoneLast4'))"
            data-testid="champ-quatre-chiffres"
          />
          <ErreurChamp :message="preparation.erreur('beneficiaryPhoneLast4')" />
          <span class="text-sm font-normal text-ink-subtle">
            {{ $t('tontine.versement.ressaisis_les_depuis_ton') }}
          </span>
        </label>

        <label
          v-if="versement.shortfall > 0 && estPresident"
          class="flex min-h-touch items-start gap-3 text-sm"
        >
          <input
            v-model="assumerIncomplet"
            type="checkbox"
            class="mt-1 size-5 shrink-0 accent-brand"
            data-testid="case-pot-incomplet"
          >
          <span>
            <span class="font-medium text-ink">{{ $t('tontine.versement.j_assume_un_pot') }}</span>
            <span class="block text-ink-muted">
              {{ $t('tontine.versement.le_montant_manquant_sera') }}
            </span>
          </span>
        </label>

        <p
          v-else-if="versement.shortfall > 0"
          class="rounded-control bg-late-surface p-3 text-sm text-late-ink"
        >
          {{ $t('tontine.versement.le_pot_n_est') }}
        </p>

        <Button
          :label="enCours ? $t('commun.preparation_en_cours') : $t('tontine.versement.preparer_le_versement')"
          :disabled="enCours || (quatreChiffres ?? '').length !== 4 || (versement.shortfall > 0 && !assumerIncomplet)"
          class="bg-brand text-brand-ink hover:bg-brand-strong"
          data-testid="bouton-preparer"
          @click="preparer"
        />
      </section>

      <!-- Étape 2 — contre-validation -->
      <section
        v-if="versement.payout?.status === 'prepared' && versement.counterValidationRequired
          && !contreValidationImpossible"
        class="flex flex-col gap-3 card-surface p-4"
        data-testid="etape-contre-validation"
      >
        <h2 class="font-semibold text-ink">
          {{ $t('tontine.versement.contre_validation') }}
        </h2>
        <p class="text-sm text-ink-muted">
          {{ $t('tontine.versement.ce_montant_depasse_le') }}
        </p>

        <Button
          v-if="peutContreValider"
          :label="enCours ? $t('tontine.versement.validation') : $t('tontine.versement.contre_valider')"
          :disabled="enCours"
          class="bg-brand text-brand-ink hover:bg-brand-strong"
          data-testid="bouton-contre-valider"
          @click="appeler('counter-validate')"
        />
        <p
          v-else
          class="rounded-control bg-surface-muted p-3 text-sm text-ink-muted"
          data-testid="attente-contre-validation"
        >
          {{ $t('tontine.versement.en_attente_d_une') }}
        </p>
      </section>

      <!-- Étape 3 — déclaration -->
      <section
        v-if="estBureau && versement.payout
          && (versement.payout.status === 'counter_validated'
            || (versement.payout.status === 'prepared'
              && (!versement.counterValidationRequired || contreValidationImpossible)))"
        class="flex flex-col gap-3 card-surface p-4"
        data-testid="etape-declaration-versement"
      >
        <h2 class="font-semibold text-ink">
          {{ $t('tontine.versement.declarer_l_envoi') }}
        </h2>
        <p class="text-sm text-ink-muted">
          {{ $t('tontine.versement.envoie_le_pot_depuis') }}
        </p>

        <!-- Dit franchement ce qui n'aura pas lieu, plutôt que de laisser
             croire que le contrôle a été fait. Règle 10 : mot + icône. -->
        <p
          v-if="contreValidationImpossible"
          class="flex items-start gap-2 rounded-control bg-declared-surface p-3 text-sm text-declared-ink"
          data-testid="avertissement-sans-contre-validation"
        >
          <Icon
            name="lucide:flag"
            size="1rem"
            class="mt-0.5 shrink-0"
            aria-hidden="true"
          />
          <span>
            {{ $t('tontine.versement.ce_montant_demanderait_une') }}
          </span>
        </p>

        <label
          class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
          for="canal-versement"
        >
          {{ $t('tontine.versement.par_quel_moyen') }}
          <select
            id="canal-versement"
            v-model="canalVersement"
            v-bind="canalVersementAttrs"
            class="min-h-touch rounded-control border border-line-strong bg-surface px-3 text-base text-ink"
            data-testid="champ-canal-versement"
          >
            <option value="wave">{{ $t('tontine.versement.wave') }}</option>
            <option value="orange">{{ $t('tontine.versement.orange_money') }}</option>
            <option value="mtn">{{ $t('tontine.versement.mtn_momo') }}</option>
            <option value="moov">{{ $t('tontine.versement.moov_money') }}</option>
            <option value="cash">{{ $t('tontine.versement.especes') }}</option>
          </select>
        </label>

        <label
          class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
          for="reference-versement"
        >
          {{ $t('tontine.versement.reference_de_la_transaction') }}
          <InputText
            id="reference-versement"
            v-model="referenceVersement"
            v-bind="referenceVersementAttrs"
            maxlength="64"
            :aria-invalid="Boolean(declarationVersement.erreur('providerRef'))"
            data-testid="champ-reference-versement"
          />
          <ErreurChamp :message="declarationVersement.erreur('providerRef')" />
        </label>

        <label
          class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
          for="preuve-versement"
        >
          {{ $t('tontine.versement.capture_de_l_envoi') }}
          <input
            id="preuve-versement"
            type="file"
            accept="image/*"
            class="min-h-touch text-sm text-ink"
            data-testid="champ-preuve-versement"
            @change="choisirPreuveVersement"
          >
          <span
            v-if="poidsPreuveVersement !== null"
            class="text-sm font-normal text-ink-subtle"
            data-testid="poids-preuve-versement"
          >
            {{ $t('tontine.versement.capture_prete_p0_ko', { p0: Math.round(poidsPreuveVersement / 1024) }) }}
          </span>
        </label>

        <Button
          :label="enCours ? $t('commun.envoi_en_cours') : $t('tontine.versement.j_ai_envoye_le')"
          :disabled="enCours"
          class="bg-brand text-brand-ink hover:bg-brand-strong"
          data-testid="bouton-declarer-versement"
          @click="declarerVersement"
        />
      </section>

      <!-- Étape 4 — accusé de réception -->
      <section
        v-if="versement.payout?.status === 'declared'"
        class="flex flex-col gap-3 card-surface p-4"
        data-testid="etape-accuse"
      >
        <h2 class="font-semibold text-ink">
          {{ $t('tontine.versement.accuse_de_reception') }}
        </h2>

        <template v-if="jeSuisBeneficiaire">
          <p class="text-sm text-ink-muted">
            {{ $t('tontine.versement.as_tu_bien_recu') }}
          </p>

          <label
            class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
            for="montant-recu"
          >
            {{ $t('tontine.versement.montant_recu_fcfa') }}
            <InputText
              id="montant-recu"
              :value="montantRecu"
              inputmode="numeric"
              :aria-invalid="Boolean(accuse.erreur('receivedAmount'))"
              data-testid="champ-montant-recu"
              @input="montantRecu = Number(($event.target as HTMLInputElement).value.replace(/\D/g, '')) || 0"
            />
            <ErreurChamp :message="accuse.erreur('receivedAmount')" />
          </label>

          <Button
            :label="enCours ? $t('commun.envoi_en_cours') : $t('tontine.versement.j_ai_bien_recu')"
            :disabled="enCours || (montantRecu ?? 0) <= 0"
            class="bg-brand text-brand-ink hover:bg-brand-strong"
            data-testid="bouton-accuser-reception"
            @click="accuserReception"
          />
        </template>

        <p
          v-else-if="versement.beneficiary.hasAccount"
          class="rounded-control bg-declared-surface p-3 text-sm text-declared-ink"
          data-testid="attente-accuse"
        >
          {{ $t('tontine.versement.le_pot_est_envoye', { p0: versement.beneficiary.name }) }}
        </p>

        <p
          v-else
          class="rounded-control bg-declared-surface p-3 text-sm text-declared-ink"
          data-testid="accuse-impossible"
        >
          {{ $t('tontine.versement.p0_n_a_pas', { p0: versement.beneficiary.name }) }}
        </p>
      </section>

      <!-- Sortie de secours — président seulement, et tracée -->
      <section
        v-if="estPresident && versement.payout?.status === 'declared' && !jeSuisBeneficiaire"
        class="flex flex-col gap-3 card-surface p-4"
        data-testid="etape-cloture-forcee"
      >
        <h2 class="font-semibold text-ink">
          {{ $t('tontine.versement.clore_le_tour_sans') }}
        </h2>
        <p class="text-sm text-ink-muted">
          {{ $t('tontine.versement.a_n_utiliser_que') }}
        </p>

        <label
          class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
          for="motif-cloture"
        >
          {{ $t('tontine.versement.pourquoi') }}
          <InputText
            id="motif-cloture"
            v-model="motifCloture"
            :placeholder="$t('tontine.versement.yao_a_recu_le')"
            data-testid="champ-motif-cloture"
          />
        </label>

        <Button
          :label="enCours ? $t('commun.cloture_en_cours') : $t('tontine.versement.clore_le_tour')"
          :disabled="enCours || motifCloture.trim().length < 5"
          class="border border-line-strong bg-surface text-ink hover:bg-surface-muted"
          data-testid="bouton-clore-tour"
          @click="clore()"
        />
      </section>

      <section
        v-if="closSansAccuse"
        class="flex flex-col gap-2 card-surface p-4"
        data-testid="tour-clos-sans-accuse"
      >
        <StatusBadge
          kind="payout"
          status="declared"
        />
        <p class="text-sm text-ink-muted">
          {{ $t('tontine.versement.le_tour_est_clos') }}
        </p>
      </section>

      <section
        v-else-if="termine || versement.payout?.status === 'acknowledged'"
        class="flex flex-col gap-2 card-surface p-4"
        data-testid="versement-termine"
      >
        <StatusBadge
          kind="payout"
          status="acknowledged"
        />
        <p class="text-sm text-ink-muted">
          {{ $t('tontine.versement.le_beneficiaire_a_accuse') }}
        </p>
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
