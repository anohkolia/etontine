<script setup lang="ts">
/**
 * Retards, amendes, avances et contestations.
 *
 * L'amende affichée est un **calcul**, pas une dette : elle dit ce que le
 * barème donnerait. Rien n'est écrit tant que le président n'a pas décidé —
 * une amende qui tombe toute seule sur quelqu'un dont la moto est en panne,
 * c'est la tontine qui perd un membre.
 */
import type { MembershipRole } from '#shared/schemas'

definePageMeta({ layout: 'app', middleware: 'auth' })
const { t } = useI18n()

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

/**
 * Une contestation ouverte sur une écriture du registre.
 *
 * Elle était déjà renvoyée par la route — et l'écran la jetait. Un signalement
 * qui n'apparaît nulle part est pire que pas de signalement : le membre croit
 * avoir alerté, et personne n'a rien vu.
 */
interface Litige {
  dispute: {
    id: string
    status: 'open' | 'resolved'
    resolution: string | null
  }
  entryType: string
  entryPosition: number
  messages: Array<{ id: string, body: string, auteur: string, createdAt: string }>
}

const etat = ref<'chargement' | 'contenu' | 'erreur'>('chargement')
const donnees = ref<{
  myRole: string
  membres: MembreSimple[]
  retards: Retard[]
  amendes: Amende[]
  avances: Avance[]
  litiges: Litige[]
} | null>(null)
const erreur = ref<string | null>(null)

const montantAmende = ref<Record<string, number>>({})
const motifAnnulation = ref<Record<string, string>>({})
const enCours = ref<string | null>(null)

const estPresident = computed(() => donnees.value?.myRole === 'president')
/**
 * Rouvrir une cotisation rejetée et clore une contestation reviennent au
 * président **ou au censeur** (data-model §2.4, §3). L'écran ne les proposait
 * qu'au président : le censeur, pourtant nommé pour cela, n'avait rien à faire.
 */
const peutTrancher = computed(() =>
  donnees.value?.myRole === 'president' || donnees.value?.myRole === 'auditor',
)

function message(e: unknown): string {
  return (e as { data?: { error?: { message?: string } } })?.data?.error?.message
    ?? t('commun.serveur_injoignable')
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

/**
 * Rouvre une cotisation contestée.
 *
 * `disputed` ne mène qu'à `confirmed` ou `due`, et re-déclarer depuis
 * `disputed` est refusé : sans ce geste, un rejet bloquait la cotisation pour
 * de bon. Le membre lisait le motif et ne pouvait rien en faire.
 */
async function rouvrir(contributionId: string) {
  erreur.value = null
  enCours.value = contributionId
  try {
    await $fetch(`/api/v1/contributions/${contributionId}/reopen`, { method: 'POST' })
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

/** Répondre dans un fil, et le clore. Le fil remplace la discussion de vive voix. */
const reponse = ref<Record<string, string>>({})
const resolution = ref<Record<string, string>>({})

async function repondre(disputeId: string) {
  erreur.value = null
  enCours.value = disputeId
  try {
    await $fetch(`/api/v1/disputes/${disputeId}/messages`, {
      method: 'POST',
      body: { message: reponse.value[disputeId] },
    })
    reponse.value[disputeId] = ''
    await charger()
  }
  catch (e) {
    erreur.value = message(e)
  }
  finally {
    enCours.value = null
  }
}

async function clore(disputeId: string) {
  erreur.value = null
  enCours.value = disputeId
  try {
    await $fetch(`/api/v1/disputes/${disputeId}/resolve`, {
      method: 'POST',
      body: { resolution: resolution.value[disputeId] },
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
useEnTete(() => ({
  titre: t('tontine.impayes.retards_et_amendes'),
  retour: { to: `/app/tontine/${tontineId}`, label: t('commun.retour_tontine') },
}))
useHead({ title: t('tontine.impayes.retards_et_amendes_etontine') })
</script>

<template>
  <div class="flex flex-col gap-5">
    <TontineTabs
      :tontine-id="tontineId"
      :role="(donnees?.myRole as MembershipRole | undefined)"
    />

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
          {{ $t('tontine.impayes.en_retard') }}
        </h2>

        <EmptyState
          v-if="donnees.retards.length === 0"
          :title="$t('tontine.impayes.personne_n_est_en')"
          :description="$t('tontine.impayes.toutes_les_cotisations_du')"
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
                  {{ $t('tontine.impayes.tour_p0_part_p1', { p0: retard.roundIndex, p1: retard.rotationPosition }) }}
                </span>
                <span class="text-sm text-late-ink">
                  {{ $t('tontine.impayes.echeance_p0', { p0: formatRelativeDay(retard.dueDate) }) }}
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
                {{ $t('tontine.impayes.le_bareme_donnerait') }}
                <AmountDisplay
                  :amount="retard.amendeCalculee"
                  size="sm"
                />
                {{ $t('tontine.impayes.d_amende_rien_n') }}
              </p>

              <label
                class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
                :for="`amende-${retard.contributionId}`"
              >
                {{ $t('tontine.impayes.montant_de_l_amende') }}
                <InputText
                  :id="`amende-${retard.contributionId}`"
                  :value="montantAmende[retard.contributionId]"
                  inputmode="numeric"
                  :data-testid="`champ-amende-${retard.contributionId}`"
                  @input="montantAmende[retard.contributionId] = Number(($event.target as HTMLInputElement).value.replace(/\D/g, '')) || 0"
                />
              </label>

              <Button
                :label="enCours === retard.contributionId ? $t('tontine.impayes.application') : $t('tontine.impayes.appliquer_l_amende')"
                :disabled="enCours !== null || !montantAmende[retard.contributionId]"
                class="border border-line-strong bg-surface text-ink hover:bg-surface-muted"
                :data-testid="`bouton-appliquer-amende-${retard.contributionId}`"
                @click="appliquer(retard.contributionId)"
              />
            </div>

            <!-- Une cotisation contestée attend qu'on la rouvre : tant qu'elle
                 reste en `disputed`, son membre ne peut pas renvoyer. -->
            <div
              v-if="peutTrancher && retard.status === 'disputed'"
              class="flex flex-col gap-2 border-t border-line pt-3"
            >
              <p class="text-sm text-ink-muted">
                {{ $t('tontine.impayes.sa_declaration_a_ete') }}
              </p>
              <Button
                :label="enCours === retard.contributionId ? $t('tontine.impayes.reouverture') : $t('tontine.impayes.rouvrir_sa_cotisation')"
                :disabled="enCours !== null"
                class="border border-line-strong bg-surface text-ink hover:bg-surface-muted"
                :data-testid="`bouton-rouvrir-${retard.contributionId}`"
                @click="rouvrir(retard.contributionId)"
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
                  {{ $t('tontine.impayes.qui_a_avance') }}
                  <select
                    :id="`preteur-${retard.contributionId}`"
                    v-model="preteur[retard.contributionId]"
                    class="min-h-touch rounded-control border border-line-strong bg-surface px-3 text-ink"
                    :data-testid="`champ-preteur-${retard.contributionId}`"
                  >
                    <option value="">
                      {{ $t('tontine.impayes.choisir_un_membre') }}
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
                  {{ $t('tontine.impayes.montant_avance_fcfa') }}
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
                    :label="enCours === retard.contributionId ? $t('tontine.impayes.enregistrement') : $t('tontine.impayes.enregistrer_l_avance')"
                    :disabled="enCours !== null
                      || !preteur[retard.contributionId]
                      || !montantAvance[retard.contributionId]"
                    class="bg-brand text-brand-ink hover:bg-brand-strong sm:flex-1"
                    :data-testid="`bouton-enregistrer-avance-${retard.contributionId}`"
                    @click="enregistrerAvance(retard)"
                  />
                  <Button
                    :label="$t('tontine.impayes.annuler')"
                    class="border border-line-strong bg-surface text-ink hover:bg-surface-muted sm:flex-1"
                    @click="avanceOuverte = null"
                  />
                </div>
              </template>

              <Button
                v-else
                :label="$t('tontine.impayes.quelqu_un_a_avance')"
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
          {{ $t('tontine.impayes.amendes') }}
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
                  {{ amende.managedName ?? $t('tontine.impayes.membre') }}
                </span>
                <span class="text-sm text-ink-muted">{{ $t('tontine.impayes.tour_p0', { p0: amende.roundIndex }) }}</span>
                <span
                  v-if="amende.penalty.reason"
                  class="text-sm text-ink-muted"
                >{{ amende.penalty.reason }}</span>
                <span
                  v-if="amende.penalty.status === 'waived'"
                  class="text-sm text-confirmed-ink"
                >
                  {{ $t('tontine.impayes.annulee_p0', { p0: amende.penalty.waiveReason }) }}
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
                {{ $t('tontine.impayes.motif_d_annulation') }}
                <InputText
                  :id="`motif-${amende.penalty.id}`"
                  v-model="motifAnnulation[amende.penalty.id]"
                  :placeholder="$t('tontine.impayes.le_membre_etait_hospitalise')"
                  :data-testid="`champ-motif-annulation-${amende.penalty.id}`"
                />
                <span class="text-sm font-normal text-ink-subtle">
                  {{ $t('tontine.impayes.obligatoire_et_inscrit_au') }}
                </span>
              </label>
              <Button
                :label="enCours === amende.penalty.id ? $t('tontine.impayes.annulation') : $t('tontine.impayes.annuler_l_amende')"
                :disabled="enCours !== null || (motifAnnulation[amende.penalty.id]?.trim().length ?? 0) < 5"
                class="border border-line-strong bg-surface text-ink hover:bg-surface-muted"
                :data-testid="`bouton-annuler-amende-${amende.penalty.id}`"
                @click="annuler(amende.penalty.id)"
              />
            </div>
          </li>
        </ul>
      </section>

      <!-- Contestations -->
      <section
        v-if="donnees.litiges.length > 0"
        class="flex flex-col gap-3"
      >
        <h2 class="font-semibold text-ink">
          {{ $t('tontine.impayes.erreurs_signalees') }}
        </h2>
        <ul
          class="flex flex-col gap-3"
          data-testid="liste-litiges"
        >
          <li
            v-for="litige in donnees.litiges"
            :key="litige.dispute.id"
            class="flex flex-col gap-3 card-surface p-4"
            :data-testid="`litige-${litige.dispute.id}`"
          >
            <div class="flex items-baseline justify-between gap-3">
              <span class="text-sm font-semibold text-ink">
                {{ $t('tontine.impayes.ecriture_n_p0', { p0: litige.entryPosition }) }}
              </span>
              <StatusBadge
                kind="dispute"
                :status="litige.dispute.status"
                compact
              />
            </div>

            <ul class="flex flex-col gap-2">
              <li
                v-for="msg in litige.messages"
                :key="msg.id"
                class="rounded-control bg-surface-muted p-3 text-sm text-ink"
              >
                <span class="font-semibold">{{ msg.auteur }}</span> — {{ msg.body }}
              </li>
            </ul>

            <p
              v-if="litige.dispute.status === 'resolved'"
              class="rounded-control bg-confirmed-surface p-3 text-sm text-confirmed-ink"
            >
              {{ $t('tontine.impayes.conclusion_p0', { p0: litige.dispute.resolution }) }}
            </p>

            <template v-else>
              <label
                class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
                :for="`reponse-${litige.dispute.id}`"
              >
                {{ $t('tontine.impayes.repondre') }}
                <InputText
                  :id="`reponse-${litige.dispute.id}`"
                  v-model="reponse[litige.dispute.id]"
                  :data-testid="`champ-reponse-${litige.dispute.id}`"
                />
              </label>
              <Button
                :label="enCours === litige.dispute.id ? $t('commun.envoi_en_cours') : $t('tontine.impayes.envoyer')"
                :disabled="enCours !== null || (reponse[litige.dispute.id]?.trim().length ?? 0) < 5"
                class="border border-line-strong bg-surface text-ink hover:bg-surface-muted"
                :data-testid="`bouton-repondre-${litige.dispute.id}`"
                @click="repondre(litige.dispute.id)"
              />

              <!-- Clore sans un mot laisse le doute là où il était. -->
              <template v-if="peutTrancher">
                <label
                  class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
                  :for="`resolution-${litige.dispute.id}`"
                >
                  {{ $t('tontine.impayes.conclusion_pour_clore') }}
                  <InputText
                    :id="`resolution-${litige.dispute.id}`"
                    v-model="resolution[litige.dispute.id]"
                    :data-testid="`champ-resolution-${litige.dispute.id}`"
                  />
                </label>
                <Button
                  :label="enCours === litige.dispute.id ? $t('commun.cloture_en_cours') : $t('commun.clore_la_contestation')"
                  :disabled="enCours !== null || (resolution[litige.dispute.id]?.trim().length ?? 0) < 5"
                  class="bg-brand text-brand-ink hover:bg-brand-strong"
                  :data-testid="`bouton-clore-litige-${litige.dispute.id}`"
                  @click="clore(litige.dispute.id)"
                />
              </template>
            </template>
          </li>
        </ul>
      </section>

      <!-- Avances -->
      <section
        v-if="donnees.avances.length > 0"
        class="flex flex-col gap-3"
      >
        <h2 class="font-semibold text-ink">
          {{ $t('tontine.impayes.avances_entre_membres') }}
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
                {{ $t('tontine.impayes.a_avance_pour') }}
                <strong class="font-semibold">{{ avance.nomBeneficiaire }}</strong>
              </span>
              <AmountDisplay
                :amount="avance.advance.amount"
                :muted="Boolean(avance.advance.settledAt)"
              />
            </div>

            <div class="flex items-center justify-between gap-3">
              <span class="text-sm text-ink-muted">
                {{ $t('tontine.impayes.tour_p0', { p0: avance.roundIndex }) }}
                <span v-if="avance.advance.settledAt"> {{ $t('tontine.impayes.soldee') }}</span>
              </span>

              <Button
                v-if="estPresident && !avance.advance.settledAt"
                :label="enCours === avance.advance.id ? $t('tontine.impayes.enregistrement') : $t('tontine.impayes.marquer_soldee')"
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
