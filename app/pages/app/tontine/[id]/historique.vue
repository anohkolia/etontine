<script setup lang="ts">
/**
 * Mon historique — tour par tour, ce que j'ai cotisé et ce que j'ai reçu.
 *
 * L'écran manquait : « Cotiser » ne montre que le tour en cours, et dès qu'un
 * tour est clos, ses cotisations et leurs reçus devenaient introuvables. Le
 * reçu d'il y a six mois est pourtant exactement ce qu'on vient chercher le
 * jour d'un désaccord. Le registre les contient, mais du point de vue du
 * groupe ; ici, c'est le mien.
 *
 * Les totaux viennent du serveur (règle 2). Le client affiche.
 */
definePageMeta({ layout: 'app', middleware: 'auth' })
const { t } = useI18n()

const route = useRoute()
const tontineId = route.params.id as string
const { formatDate } = useDate()

interface Declaration {
  id: string
  amount: number
  channel: string
  decision: 'pending' | 'confirmed' | 'rejected'
  declaredAt: string
  decidedAt: string | null
  rejectionReason: string | null
}

interface Cotisation {
  id: string
  status: 'due' | 'late' | 'declared' | 'confirmed' | 'disputed'
  expectedAmount: number
  confirmedAmount: number
  declarations: Declaration[]
  amendes: Array<{ id: string, amount: number, status: 'applied' | 'waived' }>
}

interface Tour {
  id: string
  index: number
  dueDate: string
  status: 'pending' | 'collecting' | 'payout_pending' | 'closed'
  beneficiaryName: string
  jePrendsLaMain: boolean
  attendu: number
  confirme: number
  cotisations: Cotisation[]
  versement: { status: string, amount: number, channel: string | null, acknowledgedAt: string | null } | null
}

const etat = ref<'chargement' | 'contenu' | 'erreur' | 'vide'>('chargement')
const erreur = ref<string | null>(null)
const tours = ref<Tour[]>([])
const totalConfirme = ref(0)
const totalRecu = ref(0)

/** Un tour déjà commencé raconte quelque chose ; un tour à venir, rien encore. */
const racontes = computed(() => tours.value.filter(t => t.status !== 'pending'))
const aVenir = computed(() => tours.value.filter(t => t.status === 'pending'))

const { copier, copie } = useCopie()
const recus = ref<Record<string, string>>({})
const recuEnCours = ref<string | null>(null)

function message(e: unknown): string {
  return (e as { data?: { error?: { message?: string } } })?.data?.error?.message
    ?? t('commun.serveur_injoignable')
}

async function charger() {
  etat.value = 'chargement'
  try {
    const donnees = await $fetch<{ rounds: Tour[], totalConfirme: number, totalRecu: number }>(
      `/api/v1/tontines/${tontineId}/my-history`,
    )
    tours.value = donnees.rounds
    totalConfirme.value = donnees.totalConfirme
    totalRecu.value = donnees.totalRecu
    etat.value = donnees.rounds.length === 0 ? 'vide' : 'contenu'
  }
  catch (e) {
    erreur.value = message(e)
    etat.value = 'erreur'
  }
}

/** Le reçu d'une déclaration confirmée : un lien signé, consultable sans compte. */
async function obtenirRecu(declarationId: string) {
  erreur.value = null
  recuEnCours.value = declarationId
  try {
    const { url } = await $fetch<{ url: string }>(
      `/api/v1/declarations/${declarationId}/receipt-link`,
      { method: 'POST' },
    )
    recus.value[declarationId] = url
  }
  catch (e) {
    erreur.value = message(e)
  }
  finally {
    recuEnCours.value = null
  }
}

onMounted(charger)
useEnTete(() => ({
  titre: t('tontine.historique.mon_historique'),
  retour: { to: `/app/tontine/${tontineId}`, label: t('commun.retour_tontine') },
}))
useHead({ title: t('tontine.historique.mon_historique_etontine') })
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
      v-else-if="etat === 'vide'"
      :title="$t('tontine.historique.rien_a_raconter_pour')"
      :description="$t('tontine.historique.ton_historique_se_remplira')"
      icon="lucide:history"
    />

    <template v-else>
      <!-- Deux totaux, calculés par le serveur : ce que j'ai versé, ce que j'ai reçu. -->
      <div class="grid grid-cols-2 gap-3">
        <div
          class="card-surface flex flex-col gap-1 p-4"
          data-testid="total-verse"
        >
          <span class="text-xs tracking-wide text-ink-muted uppercase">{{ $t('tontine.historique.cotise_et_confirme') }}</span>
          <AmountDisplay
            :amount="totalConfirme"
            size="lg"
          />
        </div>
        <div
          class="card-surface flex flex-col gap-1 p-4"
          data-testid="total-recu"
        >
          <span class="text-xs tracking-wide text-ink-muted uppercase">{{ $t('tontine.historique.recu_du_pot') }}</span>
          <AmountDisplay
            :amount="totalRecu"
            size="lg"
          />
        </div>
      </div>

      <p
        v-if="erreur"
        role="alert"
        class="rounded-control bg-disputed-surface p-3 text-sm text-disputed-ink"
      >
        {{ erreur }}
      </p>

      <ul
        class="flex flex-col gap-3"
        data-testid="liste-historique"
      >
        <li
          v-for="tour in racontes"
          :key="tour.id"
          class="card-surface flex flex-col gap-3 p-4"
          :data-testid="`historique-tour-${tour.index}`"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="flex flex-col">
              <span class="font-semibold text-ink">{{ $t('tontine.historique.tour_p0', { p0: tour.index }) }}</span>
              <span class="tabular text-sm text-ink-muted">{{ formatDate(tour.dueDate) }}</span>
              <span class="text-sm text-ink-muted">
                {{ $t('tontine.historique.a_pris_la_main') }} <span class="font-medium text-ink">{{ tour.beneficiaryName }}</span>
                <span
                  v-if="tour.jePrendsLaMain"
                  class="font-bold text-brand-strong"
                > {{ $t('tontine.historique.c_est_toi') }}</span>
              </span>
            </div>
            <StatusBadge
              kind="round"
              :status="tour.status"
              compact
            />
          </div>

          <!-- Ce que j'ai cotisé sur ce tour, toutes mes parts additionnées. -->
          <div class="flex items-center justify-between gap-3 rounded-control bg-surface-muted p-3">
            <span class="text-sm text-ink-muted">{{ $t('tontine.historique.ma_cotisation') }}</span>
            <span class="text-sm">
              <AmountDisplay
                :amount="tour.confirme"
                size="sm"
              />
              <span class="text-ink-muted"> {{ $t('tontine.historique.sur') }} </span>
              <AmountDisplay
                :amount="tour.attendu"
                size="sm"
              />
            </span>
          </div>

          <ul class="flex flex-col gap-2">
            <li
              v-for="cotisation in tour.cotisations"
              :key="cotisation.id"
              class="flex flex-col gap-2"
            >
              <div class="flex items-center justify-between gap-3">
                <StatusBadge
                  kind="contribution"
                  :status="cotisation.status"
                  compact
                />
                <span
                  v-if="cotisation.amendes.some(a => a.status === 'applied')"
                  class="text-sm text-late-ink"
                >
                  {{ $t('tontine.historique.amende_appliquee') }}
                </span>
              </div>

              <div
                v-for="declaration in cotisation.declarations"
                :key="declaration.id"
                class="flex flex-wrap items-center justify-between gap-2 text-sm"
              >
                <span class="text-ink-muted">
                  <AmountDisplay
                    :amount="declaration.amount"
                    size="sm"
                  />
                  · {{ formatDate(declaration.declaredAt) }}
                  <template v-if="declaration.decision === 'rejected'">
                    {{ $t('tontine.historique.rejetee_p0', { p0: declaration.rejectionReason ? ` : ${declaration.rejectionReason}` : '' }) }}
                  </template>
                  <template v-else-if="declaration.decision === 'pending'">
                    {{ $t('tontine.historique.en_attente') }}
                  </template>
                </span>

                <!-- Le reçu ne vaut que pour une déclaration confirmée. -->
                <template v-if="declaration.decision === 'confirmed'">
                  <a
                    v-if="recus[declaration.id]"
                    :href="recus[declaration.id]"
                    target="_blank"
                    rel="noopener"
                    class="min-h-touch inline-flex items-center gap-1 font-semibold text-brand underline underline-offset-4"
                    :data-testid="`lien-recu-${declaration.id}`"
                  >
                    {{ $t('tontine.historique.ouvrir_le_recu') }}
                  </a>
                  <button
                    v-if="recus[declaration.id]"
                    type="button"
                    class="min-h-touch text-ink-muted underline underline-offset-4"
                    @click="copier(recus[declaration.id]!)"
                  >
                    {{ copie ? $t('commun.lien_copie') : $t('commun.copier_le_lien') }}
                  </button>
                  <button
                    v-else
                    type="button"
                    class="min-h-touch font-semibold text-brand underline underline-offset-4"
                    :disabled="recuEnCours === declaration.id"
                    :data-testid="`bouton-recu-${declaration.id}`"
                    @click="obtenirRecu(declaration.id)"
                  >
                    {{ recuEnCours === declaration.id ? $t('commun.preparation_en_cours') : $t('tontine.historique.recu') }}
                  </button>
                </template>
              </div>
            </li>
          </ul>

          <!-- Le pot reçu, quand c'était mon tour. -->
          <p
            v-if="tour.versement"
            class="flex items-center justify-between gap-3 rounded-control bg-brand-surface p-3 text-sm text-brand-strong"
            :data-testid="`versement-recu-${tour.index}`"
          >
            <span>
              {{ tour.versement.status === 'acknowledged' ? $t('tontine.historique.pot_recu') : $t('tontine.historique.pot_envoye') }}
              <template v-if="tour.versement.acknowledgedAt">
                · {{ formatDate(tour.versement.acknowledgedAt) }}
              </template>
            </span>
            <AmountDisplay
              :amount="tour.versement.amount"
              size="sm"
            />
          </p>
        </li>
      </ul>

      <p
        v-if="aVenir.length > 0"
        class="text-sm text-ink-muted"
        data-testid="tours-a-venir"
      >
        {{ $t('tontine.historique.p0_tour_p1_a', { p0: aVenir.length, p1: aVenir.length > 1 ? 's' : '' }) }}
        <template v-if="aVenir.some(t => t.jePrendsLaMain)">
          {{ $t('tontine.historique.tu_prendras_la_main', { p0: aVenir.find(t => t.jePrendsLaMain)!.index }) }}
        </template>
      </p>
    </template>
  </div>
</template>

<!--
  États d'écran (règle 14) :
  · chargement — LoadingSkeleton
  · vide       — EmptyState tant qu'aucun tour n'existe
  · erreur     — ErrorState avec reprise ; message en ligne pour un reçu
  · hors-ligne — bandeau porté par `layouts/app.vue`
  · contenu    — l'écran
-->
