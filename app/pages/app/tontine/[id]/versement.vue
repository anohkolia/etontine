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
definePageMeta({ layout: 'app', middleware: 'auth' })

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

const quatreChiffres = ref('')
const assumerIncomplet = ref(false)
const canalVersement = ref<'wave' | 'orange' | 'mtn' | 'moov' | 'cash'>('wave')
const referenceVersement = ref('')
const montantRecu = ref(0)

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
    ?? 'Impossible de joindre le serveur.'
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
    montantRecu.value = versement.value.payout?.amount ?? versement.value.collected
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

onMounted(async () => {
  await session.charger()
  await charger()
})

useEnTete(() => ({
  titre: 'Verser le pot',
  retour: { to: '/app', label: 'Mes tontines' },
}))
useHead({ title: 'Verser le pot — eTontine' })
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
      title="Aucun tour en cours"
      description="Il n’y a pas de pot à verser pour l’instant."
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
        Tu as confirmé avoir reçu le pot. Le tour est clos.
      </p>
    </section>

    <template v-else-if="versement">
      <!-- Pot constitué face au pot attendu -->
      <section class="flex flex-col gap-3 card-surface p-4">
        <h2 class="font-semibold text-ink">
          Tour {{ versement.roundIndex }}
        </h2>

        <div class="flex flex-col gap-1">
          <p class="text-sm text-ink-muted">
            Pot constitué
          </p>
          <AmountDisplay
            :amount="versement.collected"
            size="xl"
            data-testid="pot-constitue"
          />
          <p class="text-sm text-ink-muted">
            sur <AmountDisplay
              :amount="versement.expected"
              size="sm"
            /> attendus
          </p>
        </div>

        <ProgressBar
          :value="Math.round((versement.collected / versement.expected) * 100)"
          :aria-label="`Pot constitué à ${Math.round((versement.collected / versement.expected) * 100)} %`"
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
            {{ versement.missing.length }} cotisation(s) non soldée(s)
          </p>
          <ul class="flex flex-col gap-1 pl-6">
            <li
              v-for="manquant in versement.missing"
              :key="manquant.membershipId"
              class="list-disc"
            >
              {{ manquant.name }} — il reste
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
          Qui prend la main
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
          Ce numéro a changé il y a moins de 48 heures. Appelle le bénéficiaire
          pour le vérifier avant d’envoyer quoi que ce soit.
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
          Préparer le versement
        </h2>

        <label
          class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
          for="quatre-chiffres"
        >
          Les quatre derniers chiffres du numéro du bénéficiaire
          <InputText
            id="quatre-chiffres"
            v-model="quatreChiffres"
            inputmode="numeric"
            maxlength="4"
            class="text-xl tracking-widest tabular-nums"
            data-testid="champ-quatre-chiffres"
          />
          <span class="text-sm font-normal text-ink-subtle">
            Ressaisis-les depuis ton téléphone, pas depuis cet écran. C’est ce
            qui empêche d’envoyer au mauvais numéro.
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
            <span class="font-medium text-ink">J’assume un pot incomplet</span>
            <span class="block text-ink-muted">
              Le montant manquant sera inscrit au registre, visible de tous.
            </span>
          </span>
        </label>

        <p
          v-else-if="versement.shortfall > 0"
          class="rounded-control bg-late-surface p-3 text-sm text-late-ink"
        >
          Le pot n’est pas complet. Seul le président peut décider de verser
          quand même.
        </p>

        <Button
          :label="enCours ? 'Préparation…' : 'Préparer le versement'"
          :disabled="enCours || quatreChiffres.length !== 4 || (versement.shortfall > 0 && !assumerIncomplet)"
          class="bg-brand text-brand-ink hover:bg-brand-strong"
          data-testid="bouton-preparer"
          @click="appeler('prepare', {
            beneficiaryPhoneLast4: quatreChiffres,
            acceptIncompletePot: assumerIncomplet,
          })"
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
          Contre-validation
        </h2>
        <p class="text-sm text-ink-muted">
          Ce montant dépasse le seuil de la tontine. Une seconde personne doit
          valider avant l’envoi : le président, le censeur, ou celui qui prend
          la main ce tour-ci.
        </p>

        <Button
          v-if="peutContreValider"
          :label="enCours ? 'Validation…' : 'Contre-valider'"
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
          En attente d’une autre personne. Celui qui a préparé le versement ne
          peut pas le contre-valider lui-même.
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
          Déclarer l’envoi
        </h2>
        <p class="text-sm text-ink-muted">
          Envoie le pot depuis ton application de paiement, puis déclare-le ici.
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
            Ce montant demanderait une contre-validation, mais tu es la seule
            personne en mesure de la donner sur ce tour. Le versement peut
            partir, et le registre gardera qu’il n’a été vu que par toi.
          </span>
        </p>

        <label
          class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
          for="canal-versement"
        >
          Par quel moyen ?
          <select
            id="canal-versement"
            v-model="canalVersement"
            class="min-h-touch rounded-control border border-line-strong bg-surface px-3 text-base text-ink"
            data-testid="champ-canal-versement"
          >
            <option value="wave">Wave</option>
            <option value="orange">Orange Money</option>
            <option value="mtn">MTN MoMo</option>
            <option value="moov">Moov Money</option>
            <option value="cash">Espèces</option>
          </select>
        </label>

        <label
          class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
          for="reference-versement"
        >
          Référence de la transaction (facultatif)
          <InputText
            id="reference-versement"
            v-model="referenceVersement"
            data-testid="champ-reference-versement"
          />
        </label>

        <Button
          :label="enCours ? 'Envoi…' : 'J’ai envoyé le pot'"
          :disabled="enCours"
          class="bg-brand text-brand-ink hover:bg-brand-strong"
          data-testid="bouton-declarer-versement"
          @click="appeler('declare', {
            channel: canalVersement,
            providerRef: referenceVersement || undefined,
          })"
        />
      </section>

      <!-- Étape 4 — accusé de réception -->
      <section
        v-if="versement.payout?.status === 'declared'"
        class="flex flex-col gap-3 card-surface p-4"
        data-testid="etape-accuse"
      >
        <h2 class="font-semibold text-ink">
          Accusé de réception
        </h2>

        <template v-if="jeSuisBeneficiaire">
          <p class="text-sm text-ink-muted">
            As-tu bien reçu le pot ? Ressaisis le montant reçu : c’est cette
            confirmation qui clôt le tour.
          </p>

          <label
            class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
            for="montant-recu"
          >
            Montant reçu (FCFA)
            <InputText
              id="montant-recu"
              :value="montantRecu"
              inputmode="numeric"
              data-testid="champ-montant-recu"
              @input="montantRecu = Number(($event.target as HTMLInputElement).value.replace(/\D/g, '')) || 0"
            />
          </label>

          <Button
            :label="enCours ? 'Envoi…' : 'J’ai bien reçu le pot'"
            :disabled="enCours || montantRecu <= 0"
            class="bg-brand text-brand-ink hover:bg-brand-strong"
            data-testid="bouton-accuser-reception"
            @click="appeler('acknowledge', { receivedAmount: montantRecu })"
          />
        </template>

        <p
          v-else
          class="rounded-control bg-declared-surface p-3 text-sm text-declared-ink"
          data-testid="attente-accuse"
        >
          Le pot est envoyé. Le tour restera ouvert tant que
          {{ versement.beneficiary.name }} n’aura pas confirmé l’avoir reçu.
        </p>
      </section>

      <section
        v-if="termine || versement.payout?.status === 'acknowledged'"
        class="flex flex-col gap-2 card-surface p-4"
        data-testid="versement-termine"
      >
        <StatusBadge
          kind="payout"
          status="acknowledged"
        />
        <p class="text-sm text-ink-muted">
          Le bénéficiaire a accusé réception. Le tour est clos.
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
