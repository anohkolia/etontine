<script setup lang="ts">
import type { Limite, PaidTier, PlanPeriodicity, PlanTier } from '#shared/constants/abonnement'
import { MOIS_OFFERTS, PALIERS, PALIER_PAR_ID, libelleLimite } from '#shared/constants/abonnement'

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
const { formatDate } = useDate()

const etat = ref<'chargement' | 'contenu' | 'erreur'>('chargement')
const abonnement = ref<EtatAbonnement | null>(null)
const erreur = ref<string | null>(null)

const periodicite = ref<PlanPeriodicity>('monthly')
const envoi = ref<PaidTier | null>(null)
const confirmation = ref<string | null>(null)

function message(e: unknown): string {
  return (e as { data?: { error?: { message?: string } } })?.data?.error?.message
    ?? 'Impossible de joindre le serveur.'
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
    confirmation.value = 'Ta demande est enregistrée. Elle sera traitée sous peu.'
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
  titre: 'Mon abonnement',
  sousTitre: abonnement.value ? `Palier ${abonnement.value.nom}` : undefined,
  retour: { to: '/app/profil', label: 'Mon profil' },
}))
useHead({ title: 'Mon abonnement — eTontine' })
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
          Mon palier
        </p>
        <h2 class="text-2xl font-bold text-ink">
          {{ abonnement.nom }}
        </h2>
        <p
          v-if="abonnement.jusquAu"
          class="text-sm text-ink-muted"
          data-testid="fin-droits"
        >
          Actif jusqu’au {{ formatDate(abonnement.jusquAu) }}.
        </p>
        <p
          v-else
          class="text-sm text-ink-muted"
        >
          Sans limite de durée. Le registre, les preuves et les reçus y sont
          inclus, comme à tous les paliers.
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
          <span class="font-semibold">Au-dessus de ton palier.</span>
          Tes tontines en cours continuent normalement, rien n’est bloqué ni
          effacé. Pour en ouvrir une nouvelle ou ajouter des membres, close une
          tontine ou passe à un palier supérieur.
        </span>
      </p>

      <!-- Consommation. Le serveur a compté, l'écran affiche. -->
      <section class="card-surface flex flex-col gap-3 p-4">
        <h2 class="font-semibold text-ink">
          Ce que j’utilise
        </h2>

        <div class="flex items-baseline justify-between gap-3 text-sm">
          <span class="text-ink-muted">Tontines en cours</span>
          <span
            class="font-semibold text-ink tabular"
            data-testid="consommation-tontines"
          >
            {{ abonnement.consommation.tontinesActives }}
            sur {{ libelleLimite(abonnement.quotas.tontinesActives) }}
          </span>
        </div>

        <EmptyState
          v-if="abonnement.consommation.tontines.length === 0"
          title="Aucune tontine en cours"
          description="Les tontines que tu présides apparaîtront ici, avec leur nombre de membres."
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
              {{ tontine.effectif }} sur {{ libelleLimite(tontine.limite) }} membres
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
          <span class="font-semibold">Demande refusée.</span>
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
          Demande en cours
        </h2>
        <p class="text-sm text-ink-muted">
          Palier
          <span class="font-semibold text-ink">{{ PALIER_PAR_ID[abonnement.demandeEnCours.tier as PlanTier].nom }}</span>,
          <span class="amount">{{ format(abonnement.demandeEnCours.priceFcfa) }}</span>
          {{ abonnement.demandeEnCours.periodicity === 'yearly' ? 'par an' : 'par mois' }},
          demandée le {{ formatDate(abonnement.demandeEnCours.createdAt) }}.
        </p>
        <p class="text-sm text-ink-muted">
          Le règlement se fait hors de l’application. Ton palier sera posé dès
          qu’il aura été constaté.
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
            Changer de palier
          </h2>
          <p class="mt-1 text-sm text-ink-muted">
            L’abonnement est payé par le président, de sa poche. On ne touche
            jamais à la caisse du groupe.
          </p>
        </div>

        <fieldset class="flex flex-col gap-2">
          <legend class="sr-only">
            Périodicité de paiement
          </legend>
          <div class="inline-flex self-start rounded-full border border-line p-1">
            <label
              v-for="choix in [
                { clef: 'monthly' as const, libelle: 'Au mois' },
                { clef: 'yearly' as const, libelle: 'À l’année' },
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
            À l’année, {{ MOIS_OFFERTS }} mois sont offerts.
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
                  {{ periodicite === 'yearly' ? '/ an' : '/ mois' }}
                </span>
              </span>
            </div>
            <p class="text-sm text-ink-muted">
              {{ libelleLimite(palier.tontinesActives) }} tontines en cours,
              {{ libelleLimite(palier.membresParTontine) }} membres par tontine.
            </p>
            <Button
              type="button"
              :label="envoi === palier.id ? 'Envoi…' : `Demander le palier ${palier.nom}`"
              :disabled="envoi !== null"
              class="bg-brand text-brand-ink hover:bg-brand-strong"
              :data-testid="`demander-${palier.id}`"
              @click="demander(palier.id as PaidTier)"
            />
          </li>
        </ul>

        <p class="text-xs leading-relaxed text-ink-subtle">
          Aucun paiement ne se fait dans l’application : elle ne détient jamais
          de fonds. Ta demande est transmise, et ton palier est posé une fois le
          règlement constaté.
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
        Comparer les paliers en détail
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
