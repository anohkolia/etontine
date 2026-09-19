<script setup lang="ts">
import type { Limite, PaidTier, PlanPeriodicity, PlanTier } from '#shared/constants/abonnement'
import { MOIS_OFFERTS, PALIERS, PALIER_PAR_ID, libelleLimite } from '#shared/constants/abonnement'
import { EDITEUR } from '#shared/constants/editeur'
import { PAYMENT_CHANNEL } from '#shared/constants/statuts'

/**
 * Mon abonnement — palier courant, ce qu'il permet, ce que j'en consomme.
 *
 * Trois partis pris, dont deux se voient à l'écran :
 *
 * 1. **Rien n'est calculé ici** (règle 2). Les effectifs, les quotas et le
 *    dépassement viennent du serveur. Le client compare zéro nombre : sinon,
 *    deux endroits calculeraient le même quota et l'écran finirait par mentir.
 * 2. **Un dépassement s'affiche, il ne se masque pas.** Un président qui a
 *    trois tontines en cours sur un palier qui en permet une le lit noir sur
 *    blanc — avec la phrase qui compte : celles en cours continuent.
 * 3. **Aucun encaissement dans le code.** Le bouton enregistre une demande ;
 *    le règlement se fait hors application, et un administrateur pose le palier
 *    une fois qu'il l'a constaté. Le prélèvement récurrent n'est pas garanti sur
 *    les rails d'ici : ne rien promettre vaut mieux que promettre à moitié.
 */
definePageMeta({ layout: 'app', middleware: 'auth' })
const { t } = useI18n()
const { canal: motDuCanal } = useLibelle()

interface ConsommationTontine {
  id: string
  name: string
  emoji: string | null
  effectif: number
  limite: Limite
}

interface EtatAbonnement {
  tier: PlanTier
  nom: string
  jusquAu: string | null
  quotas: { tontinesActives: Limite, membresParTontine: Limite }
  consommation: { tontinesActives: number, tontines: ConsommationTontine[] }
  auDessus: boolean
  demandeEnCours: {
    id: string
    reference: string
    tier: string
    periodicity: PlanPeriodicity
    priceFcfa: number
    createdAt: string
  } | null
  derniereDecision: {
    status: 'approved' | 'rejected'
    tier: string
    note: string | null
    reviewedAt: string | null
  } | null
}

const { format } = useMoney()
const { copier, copie } = useCopie()

/** Où régler : configuré par l'exploitant, jamais deviné par l'écran. */
const reglement = useRuntimeConfig().public.abonnementReglement as {
  operateur: string
  numero: string
  titulaire: string
  contact: string
}
const presentationOperateur = computed(() => {
  const connu = PAYMENT_CHANNEL[reglement.operateur as keyof typeof PAYMENT_CHANNEL]
  return connu ? motDuCanal(reglement.operateur, connu.label) : reglement.operateur
})
const { formatDate } = useDate()

const etat = ref<'chargement' | 'contenu' | 'erreur'>('chargement')
const abonnement = ref<EtatAbonnement | null>(null)
const erreur = ref<string | null>(null)

const periodicite = ref<PlanPeriodicity>('monthly')
const envoi = ref<PaidTier | null>(null)
const confirmation = ref<string | null>(null)

function message(e: unknown): string {
  return (e as { data?: { error?: { message?: string } } })?.data?.error?.message
    ?? t('commun.serveur_injoignable')
}

async function charger() {
  etat.value = 'chargement'
  erreur.value = null
  try {
    abonnement.value = await $fetch<EtatAbonnement>('/api/v1/me/subscription')
    etat.value = 'contenu'
  }
  catch (e) {
    erreur.value = message(e)
    etat.value = 'erreur'
  }
}

onMounted(charger)

/** Les paliers proposés : tous sauf celui qui est déjà en place. */
const propositions = computed(() =>
  PALIERS.filter(p => p.id !== 'free' && p.id !== abonnement.value?.tier))

function prix(tier: PaidTier): number {
  const palier = PALIER_PAR_ID[tier]
  return periodicite.value === 'yearly' ? palier.prixAnnuel : palier.prixMensuel
}

async function demander(tier: PaidTier) {
  erreur.value = null
  confirmation.value = null
  envoi.value = tier
  try {
    await $fetch('/api/v1/me/subscription/request', {
      method: 'POST',
      // Règle 4 : la demande engage une somme, un réseau qui coupe ne doit pas
      // en produire deux.
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      body: { tier, periodicity: periodicite.value },
    })
    confirmation.value = t('abonnement.ta_demande_est_enregistree')
    await charger()
  }
  catch (e) {
    erreur.value = message(e)
  }
  finally {
    envoi.value = null
  }
}

useEnTete(() => ({
  titre: t('abonnement.mon_abonnement'),
  sousTitre: abonnement.value ? `Palier ${abonnement.value.nom}` : undefined,
  retour: { to: '/app/profil', label: t('commun.mon_profil') },
}))
useHead({ title: t('abonnement.mon_abonnement_etontine') })
</script>

<template>
  <div class="flex flex-col gap-5">
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

    <template v-else-if="abonnement">
      <!-- Palier courant -->
      <section
        class="card-surface flex flex-col gap-2 p-5"
        data-testid="palier-courant"
      >
        <p class="text-xs font-semibold tracking-wide text-ink-muted uppercase">
          {{ $t('abonnement.mon_palier') }}
        </p>
        <h2 class="text-2xl font-bold text-ink">
          {{ abonnement.nom }}
        </h2>
        <p
          v-if="abonnement.jusquAu"
          class="text-sm text-ink-muted"
          data-testid="fin-droits"
        >
          {{ $t('abonnement.actif_jusqu_au_p0', { p0: formatDate(abonnement.jusquAu) }) }}
        </p>
        <p
          v-else
          class="text-sm text-ink-muted"
        >
          {{ $t('abonnement.sans_limite_de_duree') }}
        </p>
      </section>

      <!-- Dépassement : dit, jamais masqué. Couleur + icône + mot (règle 10). -->
      <p
        v-if="abonnement.auDessus"
        class="flex items-start gap-2 rounded-control bg-late-surface p-3 text-sm text-late-ink"
        data-testid="au-dessus-du-palier"
      >
        <Icon
          name="lucide:triangle-alert"
          size="1rem"
          class="mt-0.5 shrink-0"
          aria-hidden="true"
        />
        <span>
          <span class="font-semibold">{{ $t('abonnement.au_dessus_de_ton') }}</span>
          {{ $t('abonnement.tes_tontines_en_cours') }}
        </span>
      </p>

      <!-- Consommation. Le serveur a compté, l'écran affiche. -->
      <section class="card-surface flex flex-col gap-3 p-4">
        <h2 class="font-semibold text-ink">
          {{ $t('abonnement.ce_que_j_utilise') }}
        </h2>

        <div class="flex items-baseline justify-between gap-3 text-sm">
          <span class="text-ink-muted">{{ $t('abonnement.tontines_en_cours') }}</span>
          <span
            class="font-semibold text-ink tabular"
            data-testid="consommation-tontines"
          >
            {{ $t('abonnement.p0_sur_p1', { p0: abonnement.consommation.tontinesActives, p1: libelleLimite(abonnement.quotas.tontinesActives) }) }}
          </span>
        </div>

        <EmptyState
          v-if="abonnement.consommation.tontines.length === 0"
          :title="$t('abonnement.aucune_tontine_en_cours')"
          :description="$t('abonnement.les_tontines_que_tu')"
          icon="lucide:circle-dashed"
          data-testid="aucune-tontine"
        />

        <!-- Cartes empilées, jamais de DataTable sous md (règle 11). -->
        <ul
          v-else
          class="flex flex-col gap-2"
          data-testid="liste-consommation"
        >
          <li
            v-for="tontine in abonnement.consommation.tontines"
            :key="tontine.id"
            class="flex min-h-touch items-center justify-between gap-3 rounded-control bg-surface-muted px-3 py-2"
            :data-testid="`consommation-${tontine.id}`"
          >
            <span class="flex min-w-0 items-center gap-2">
              <span
                v-if="tontine.emoji"
                aria-hidden="true"
              >{{ tontine.emoji }}</span>
              <span class="truncate text-sm font-medium text-ink">{{ tontine.name }}</span>
            </span>
            <span class="tabular shrink-0 text-sm text-ink-muted">
              {{ $t('abonnement.p0_sur_p1_membres', { p0: tontine.effectif, p1: libelleLimite(tontine.limite) }) }}
            </span>
          </li>
        </ul>
      </section>

      <!-- Décision rendue sur la dernière demande -->
      <p
        v-if="abonnement.derniereDecision?.status === 'rejected' && !abonnement.demandeEnCours"
        class="flex items-start gap-2 rounded-control bg-disputed-surface p-3 text-sm text-disputed-ink"
        data-testid="derniere-decision"
      >
        <Icon
          name="lucide:circle-x"
          size="1rem"
          class="mt-0.5 shrink-0"
          aria-hidden="true"
        />
        <span>
          <span class="font-semibold">{{ $t('abonnement.demande_refusee') }}</span>
          {{ abonnement.derniereDecision.note }}
        </span>
      </p>

      <!-- Demande en cours : plus de bouton, on attend une décision. -->
      <section
        v-if="abonnement.demandeEnCours"
        class="card-surface flex flex-col gap-2 p-4"
        data-testid="demande-en-cours"
      >
        <h2 class="flex items-center gap-2 font-semibold text-ink">
          <Icon
            name="lucide:clock"
            size="1rem"
            class="text-declared-ink"
            aria-hidden="true"
          />
          {{ $t('abonnement.demande_en_cours') }}
        </h2>
        <p class="text-sm text-ink-muted">
          {{ $t('abonnement.palier') }}
          <span class="font-semibold text-ink">{{ PALIER_PAR_ID[abonnement.demandeEnCours.tier as PlanTier].nom }}</span>,
          <span class="amount">{{ format(abonnement.demandeEnCours.priceFcfa) }}</span>
          {{ $t('abonnement.p0_demandee_le_p1', { p0: abonnement.demandeEnCours.periodicity === 'yearly' ? $t('commun.par_an') : $t('commun.par_mois'), p1: formatDate(abonnement.demandeEnCours.createdAt) }) }}
        </p>
        <!-- Où payer, en clair. « Hors de l'application » sans numéro ni
             référence était une impasse : personne ne pouvait régler. -->
        <div
          v-if="reglement.numero"
          class="flex flex-col gap-2 rounded-control bg-surface-muted p-3 text-sm"
          data-testid="instructions-reglement"
        >
          <p class="font-semibold text-ink">
            {{ $t('abonnement.pour_regler') }}
          </p>
          <ol class="flex list-decimal flex-col gap-1.5 pl-5 text-ink-muted">
            <li>
              {{ $t('abonnement.envoie') }} <span class="amount font-semibold text-ink">{{ format(abonnement.demandeEnCours.priceFcfa) }}</span>
              {{ $t('abonnement.par') }} <span class="font-semibold text-ink">{{ presentationOperateur }}</span> {{ $t('abonnement.au') }}
              <span
                class="font-mono font-semibold text-ink tabular-nums"
                data-testid="numero-reglement"
              >{{ reglement.numero }}</span>
              <template v-if="reglement.titulaire">
                {{ $t('abonnement.titulaire') }} <span class="font-semibold text-ink">{{ reglement.titulaire }}</span>
              </template>.
            </li>
            <li>
              {{ $t('abonnement.indique_la_reference') }}
              <span
                class="font-mono font-semibold text-ink"
                data-testid="reference-reglement"
              >{{ abonnement.demandeEnCours.reference }}</span>
              {{ $t('abonnement.dans_le_motif_de') }}
              <button
                type="button"
                class="ml-1 min-h-touch text-brand underline underline-offset-4"
                data-testid="bouton-copier-reference"
                @click="copier(abonnement.demandeEnCours.reference)"
              >
                {{ copie ? $t('abonnement.copiee') : $t('abonnement.copier') }}
              </button>
            </li>
            <li v-if="reglement.contact">
              {{ $t('abonnement.envoie_la_capture_de') }}
              <a
                :href="`https://wa.me/${reglement.contact.replace(/\D/g, '')}?text=${encodeURIComponent(`Règlement eTontine ${abonnement.demandeEnCours.reference}`)}`"
                target="_blank"
                rel="noopener"
                class="font-semibold text-brand underline underline-offset-4"
                data-testid="lien-whatsapp-reglement"
              >{{ reglement.contact }}</a>.
            </li>
          </ol>
          <p class="text-ink-muted">
            {{ $t('abonnement.ton_palier_sera_pose') }}
          </p>
        </div>
        <p
          v-else
          class="text-sm text-ink-muted"
          data-testid="instructions-reglement"
        >
          {{ $t('abonnement.le_reglement_se_fait') }}
          <a
            :href="`mailto:${EDITEUR.email}`"
            class="text-brand underline underline-offset-4"
          >{{ EDITEUR.email }}</a>
          {{ $t('abonnement.en_citant_la_reference') }}
          <span
            class="font-mono font-semibold text-ink"
            data-testid="reference-reglement"
          >{{ abonnement.demandeEnCours.reference }}</span>
          {{ $t('abonnement.pour_connaitre_les_modalites') }}
        </p>
      </section>

      <!-- Passage à un palier supérieur -->
      <section
        v-else-if="propositions.length > 0"
        class="card-surface flex flex-col gap-4 p-4"
        data-testid="changer-de-palier"
      >
        <div>
          <h2 class="font-semibold text-ink">
            {{ $t('abonnement.changer_de_palier') }}
          </h2>
          <p class="mt-1 text-sm text-ink-muted">
            {{ $t('abonnement.l_abonnement_est_paye') }}
          </p>
        </div>

        <fieldset class="flex flex-col gap-2">
          <legend class="sr-only">
            {{ $t('abonnement.periodicite_de_paiement') }}
          </legend>
          <div class="inline-flex self-start rounded-full border border-line p-1">
            <label
              v-for="choix in [
                { clef: 'monthly' as const, libelle: $t('commun.au_mois') },
                { clef: 'yearly' as const, libelle: $t('commun.a_l_annee') },
              ]"
              :key="choix.clef"
              class="min-h-touch inline-flex cursor-pointer items-center rounded-full px-4 text-sm font-semibold"
              :class="periodicite === choix.clef
                ? 'bg-brand text-brand-ink'
                : 'text-ink-muted hover:text-ink'"
              :data-testid="`periodicite-${choix.clef}`"
            >
              <!-- Masqué à l'œil, présent pour le clavier et le lecteur
                   d'écran : l'étiquette est la cible tactile. -->
              <input
                v-model="periodicite"
                type="radio"
                name="periodicite"
                :value="choix.clef"
                class="sr-only"
              >
              {{ choix.libelle }}
            </label>
          </div>
          <p class="text-xs text-ink-muted">
            {{ $t('abonnement.a_l_annee_p0', { p0: MOIS_OFFERTS }) }}
          </p>
        </fieldset>

        <ul class="flex flex-col gap-3">
          <li
            v-for="palier in propositions"
            :key="palier.id"
            class="flex flex-col gap-2 rounded-control border border-line p-3"
            :data-testid="`proposition-${palier.id}`"
          >
            <div class="flex items-baseline justify-between gap-3">
              <span class="font-semibold text-ink">{{ palier.nom }}</span>
              <span class="amount font-bold text-ink">
                {{ format(prix(palier.id as PaidTier)) }}
                <span class="text-xs font-normal text-ink-muted">
                  {{ periodicite === 'yearly' ? $t('abonnement.par_an_court') : $t('abonnement.par_mois_court') }}
                </span>
              </span>
            </div>
            <p class="text-sm text-ink-muted">
              {{ $t('abonnement.p0_tontines_en_cours', { p0: libelleLimite(palier.tontinesActives), p1: libelleLimite(palier.membresParTontine) }) }}
            </p>
            <Button
              type="button"
              :label="envoi === palier.id ? $t('commun.envoi_en_cours') : `Demander le palier ${palier.nom}`"
              :disabled="envoi !== null"
              class="bg-brand text-brand-ink hover:bg-brand-strong"
              :data-testid="`demander-${palier.id}`"
              @click="demander(palier.id as PaidTier)"
            />
          </li>
        </ul>

        <p class="text-xs leading-relaxed text-ink-subtle">
          {{ $t('abonnement.aucun_paiement_ne_se') }}
        </p>
      </section>

      <p
        v-if="confirmation"
        role="status"
        class="text-sm text-confirmed-ink"
        data-testid="demande-enregistree"
      >
        {{ confirmation }}
      </p>
      <p
        v-if="erreur"
        role="alert"
        class="text-sm text-disputed-ink"
        data-testid="erreur-demande"
      >
        {{ erreur }}
      </p>

      <NuxtLink
        to="/tarifs"
        class="min-h-touch flex items-center gap-2 text-sm text-brand underline underline-offset-4"
        data-testid="lien-tarifs"
      >
        <Icon
          name="lucide:table-2"
          size="1rem"
          aria-hidden="true"
        />
        {{ $t('abonnement.comparer_les_paliers_en') }}
      </NuxtLink>
    </template>
  </div>
</template>

<!--
  États d'écran (règle 14) :
  · chargement — LoadingSkeleton pendant la lecture de l'abonnement
  · vide       — EmptyState quand on ne préside aucune tontine en cours
  · erreur     — ErrorState avec reprise au chargement, message en ligne sur une demande
  · hors-ligne — bandeau porté par `layouts/app.vue`
  · contenu    — palier, consommation, changement de palier
-->
