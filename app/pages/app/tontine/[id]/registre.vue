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
import type { paymentChannel } from '#shared/schemas'
import type { z } from 'zod'
import { PAYMENT_CHANNEL } from '#shared/constants/statuts'

definePageMeta({ layout: 'app', middleware: 'auth' })
const { t } = useI18n()

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
  contribution_declared: t('tontine.registre.cotisation_declaree'),
  contribution_confirmed: t('tontine.registre.cotisation_confirmee'),
  contribution_rejected: t('tontine.registre.cotisation_rejetee'),
  penalty_applied: t('tontine.registre.amende_appliquee'),
  penalty_waived: t('tontine.registre.amende_annulee'),
  payout_declared: t('tontine.registre.pot_verse'),
  payout_acknowledged: t('tontine.registre.pot_recu'),
  member_joined: t('tontine.registre.membre_arrive'),
  member_left: t('tontine.registre.membre_parti'),
  rotation_changed: t('tontine.registre.ordre_de_passage_fixe'),
  settings_changed: t('tontine.registre.reglage_modifie'),
  reversal: t('tontine.registre.annulation'),
  declaration_escalated: t('tontine.registre.declaration_en_souffrance'),
  cash_unconfirmed: t('tontine.registre.especes_non_reconnues'),
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

/**
 * Un « réglage modifié » ne dit rien : c'est le `changement` du contenu qui
 * dit s'il s'agit d'un démarrage, d'une nomination, d'une annulation. Sans
 * cette table, la moitié des faits marquants de la vie d'une tontine se
 * lisaient sous le même mot.
 */
const CHANGEMENT: Record<string, string> = {
  demarrage: t('tontine.registre.tontine_demarree'),
  canal_de_collecte: t('tontine.registre.numero_de_collecte_change'),
  role_modifie: t('tontine.registre.role_modifie'),
  presidence_transferee: t('tontine.registre.presidence_transferee'),
  membre_defaillant: t('tontine.registre.membre_declare_defaillant'),
  annulation: t('tontine.registre.tontine_annulee'),
  archivage: t('tontine.registre.tontine_archivee'),
  cloture_tontine: t('tontine.registre.tontine_terminee'),
  cloture_sans_accuse: t('tontine.registre.tour_clos_sans_accuse'),
  pot_incomplet_assume: t('tontine.registre.pot_incomplet_assume'),
  cotisation_rouverte: t('tontine.registre.cotisation_rouverte'),
  date_demarrage: t('tontine.registre.date_de_demarrage_changee'),
  numero_change: t('tontine.registre.numero_de_telephone_change'),
}

function libelleDe(e: Ecriture): string {
  if (e.type === 'settings_changed') {
    const changement = e.payload.changement
    if (typeof changement === 'string' && CHANGEMENT[changement]) return CHANGEMENT[changement]!
  }
  return LIBELLE[e.type] ?? e.type
}

/** Ce qu'une écriture de réglage a de plus à dire : qui, vers quoi, pourquoi. */
function detailDe(e: Ecriture): string | null {
  if (e.type !== 'settings_changed') return null
  const p = e.payload as Record<string, unknown>
  switch (p.changement) {
    case 'role_modifie':
      return typeof p.name === 'string' ? `${p.name} : ${ROLE_FR[String(p.de)] ?? p.de} → ${ROLE_FR[String(p.vers)] ?? p.vers}` : null
    case 'presidence_transferee': {
      const vers = p.vers as { name?: string } | null
      return vers?.name ? t('tontine.registre.preside_desormais', { nom: vers.name }) : null
    }
    case 'membre_defaillant':
      return typeof p.name === 'string' ? p.name : null
    case 'annulation':
    case 'cloture_sans_accuse':
      return typeof p.motif === 'string' ? `Motif : ${p.motif}` : null
    default:
      return null
  }
}

const ROLE_FR: Record<string, string> = {
  president: t('tontine.registre.president'), treasurer: t('tontine.registre.tresorier'), auditor: 'censeur', member: 'membre',
}

function iconeDe(e: Ecriture): string {
  return ICONE[e.type] ?? 'lucide:circle-dashed'
}

const CANAUX_CONNUS = new Set(Object.keys(PAYMENT_CHANNEL))

/**
 * Signalement d'une erreur sur une écriture.
 *
 * Le registre est append-only : rien ne s'efface, donc la seule façon de dire
 * « ce n'est pas ce qui s'est passé » est de l'écrire à côté et que tout le
 * monde le voie. `ouvrirContestation` et sa route existaient ; aucun écran
 * n'ouvrait la porte. Un membre qui contestait n'avait donc plus qu'un
 * recours : quitter la tontine en accusant le bureau.
 */
const signalementOuvert = ref<string | null>(null)
const messageSignalement = ref('')
const signalementEnvoye = ref<string | null>(null)
const signalementEnCours = ref(false)

async function signaler(entryId: string) {
  signalementEnCours.value = true
  try {
    await $fetch(`/api/v1/ledger/${entryId}/dispute`, {
      method: 'POST',
      body: { message: messageSignalement.value.trim() },
    })
    signalementOuvert.value = null
    messageSignalement.value = ''
    signalementEnvoye.value = entryId
    await chargerLitiges()
  }
  catch (e) {
    erreur.value = (e as { data?: { error?: { message?: string } } })?.data?.error?.message
      ?? t('commun.serveur_injoignable')
  }
  finally {
    signalementEnCours.value = false
  }
}

const etat = ref<'chargement' | 'contenu' | 'erreur'>('chargement')
const ecritures = ref<Ecriture[]>([])
const erreur = ref<string | null>(null)
const filtreType = ref('')

/**
 * Pagination par curseur. L'écran se contentait des cent premières écritures :
 * une tontine de douze membres les dépasse au quatrième tour, et tout ce qui
 * précédait devenait introuvable — précisément ce qu'on vient chercher dans un
 * registre.
 */
const suite = ref<string | null>(null)
const suiteEnCours = ref(false)

async function chargerSuite() {
  if (!suite.value) return
  suiteEnCours.value = true
  try {
    const reponse = await $fetch<{ items: Ecriture[], nextCursor: string | null }>(
      `/api/v1/tontines/${tontineId}/ledger?limit=50&cursor=${suite.value}`,
    )
    ecritures.value = [...ecritures.value, ...reponse.items]
    suite.value = reponse.nextCursor
  }
  catch (e) {
    erreur.value = message(e)
  }
  finally {
    suiteEnCours.value = false
  }
}

/**
 * Les contestations, lisibles et répondables par **tout membre**.
 *
 * Elles ne s'affichaient que sur l'écran des impayés, que la navigation
 * réserve au bureau : le membre qui avait signalé une erreur ne voyait ni les
 * réponses ni la conclusion, et la notification le renvoyait ici — sur un
 * écran qui ne montrait rien. Président et censeur tranchent ; les autres
 * répondent.
 */
interface Litige {
  dispute: { id: string, status: 'open' | 'resolved', resolution: string | null, ledgerEntryId: string }
  entryType: string
  entryPosition: number
  messages: Array<{ id: string, body: string, auteur: string, createdAt: string }>
}

const litiges = ref<Litige[]>([])
const monRole = ref<string | null>(null)
const peutTrancher = computed(() => monRole.value === 'president' || monRole.value === 'auditor')
const reponse = ref<Record<string, string>>({})
const resolution = ref<Record<string, string>>({})
const litigeEnCours = ref<string | null>(null)

async function chargerLitiges() {
  try {
    const donnees = await $fetch<{ myRole: string, litiges: Litige[] }>(`/api/v1/tontines/${tontineId}/disputes`)
    litiges.value = donnees.litiges
    monRole.value = donnees.myRole
  }
  catch {
    // Les contestations sont un complément : leur absence n'empêche pas de
    // lire le registre, et l'erreur principale est déjà traitée par `charger`.
  }
}

async function repondre(disputeId: string) {
  litigeEnCours.value = disputeId
  try {
    await $fetch(`/api/v1/disputes/${disputeId}/messages`, {
      method: 'POST',
      body: { message: reponse.value[disputeId]?.trim() },
    })
    reponse.value[disputeId] = ''
    await chargerLitiges()
  }
  catch (e) {
    erreur.value = message(e)
  }
  finally {
    litigeEnCours.value = null
  }
}

async function clore(disputeId: string) {
  litigeEnCours.value = disputeId
  try {
    await $fetch(`/api/v1/disputes/${disputeId}/resolve`, {
      method: 'POST',
      body: { resolution: resolution.value[disputeId]?.trim() },
    })
    await chargerLitiges()
  }
  catch (e) {
    erreur.value = message(e)
  }
  finally {
    litigeEnCours.value = null
  }
}
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
    ?? t('commun.serveur_injoignable')
}

/**
 * Le canal porté par une écriture, s'il y en a un.
 *
 * Le registre des écritures est volontairement générique côté serveur : le
 * `payload` est un objet libre, propre à chaque type. On y lit le canal quand
 * il existe, et **seulement** s'il fait partie de l'énumération partagée — une
 * valeur inconnue ne doit pas produire une pastille sans couleur ni mot.
 */
function canalDe(ecriture: Ecriture): z.infer<typeof paymentChannel> | null {
  const valeur = ecriture.payload.channel
  return typeof valeur === 'string' && CANAUX_CONNUS.has(valeur)
    ? valeur as z.infer<typeof paymentChannel>
    : null
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
    const chemin = `/api/v1/tontines/${tontineId}/ledger?limit=50`
    const page = await $fetch<{ items: Ecriture[], nextCursor: string | null }>(chemin)
    ecritures.value = page.items
    suite.value = page.nextCursor
    etat.value = 'contenu'
    await chargerLitiges()
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
useEnTete(() => ({
  titre: t('tontine.registre.registre'),
  retour: { to: `/app/tontine/${tontineId}`, label: t('commun.retour_tontine') },
}))
useHead({ title: t('tontine.registre.registre_etontine') })
</script>

<template>
  <div class="flex flex-col gap-5">
    <TontineTabs :tontine-id="tontineId" />

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
      :title="$t('tontine.registre.le_registre_est_vide')"
      :description="$t('tontine.registre.les_ecritures_apparaitront_ici')"
      icon="lucide:book-open"
    />

    <template v-else>
      <!-- Contrôle d'intégrité, ouvert à tous -->
      <section class="flex flex-col gap-2 card-surface p-4">
        <h2 class="font-semibold text-ink">
          {{ $t('tontine.registre.controle_du_registre') }}
        </h2>
        <p class="text-sm text-ink-muted">
          {{ $t('tontine.registre.chaque_ecriture_est_chainee') }}
        </p>

        <Button
          :label="verificationEnCours ? $t('commun.verification_en_cours') : $t('tontine.registre.verifier_le_registre')"
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
          {{ $t('tontine.registre.le_registre_est_intact') }}
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
        {{ $t('tontine.registre.filtrer_par_type') }}
        <select
          id="filtre-type"
          v-model="filtreType"
          class="min-h-touch rounded-control border border-line-strong bg-surface px-3 text-base text-ink"
          data-testid="filtre-type"
        >
          <option value="">
            {{ $t('tontine.registre.tout_le_registre') }}
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
          class="card-surface flex items-start gap-3 p-3"
          :data-testid="`ecriture-${ecriture.position}`"
        >
          <span
            class="flex size-9 shrink-0 items-center justify-center rounded-control bg-surface-muted text-ink-muted"
            aria-hidden="true"
          >
            <Icon
              :name="iconeDe(ecriture)"
              size="1.25rem"
            />
          </span>

          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <span class="font-semibold text-ink">
              {{ libelleDe(ecriture) }}
            </span>
            <span class="tabular text-sm text-ink-muted">
              {{ $t('tontine.registre.p0_ecriture_n_p1', { p0: formatDate(ecriture.serverTimestamp), p1: ecriture.position }) }}
            </span>
            <span
              v-if="detailDe(ecriture)"
              class="text-sm text-ink-muted"
              :data-testid="`detail-${ecriture.position}`"
            >
              {{ detailDe(ecriture) }}
            </span>
            <!-- La soupape : rien ne s'efface d'un registre append-only, on
                 écrit à côté. Ouverte à tout membre, pas au seul bureau. -->
            <p
              v-if="signalementEnvoye === ecriture.id"
              class="text-sm text-confirmed-ink"
              :data-testid="`signalement-envoye-${ecriture.id}`"
            >
              {{ $t('tontine.registre.signalement_envoye_le_bureau') }}
            </p>

            <template v-else-if="signalementOuvert === ecriture.id">
              <label
                class="flex flex-col gap-1.5 pt-1 text-sm font-medium text-ink-muted"
                :for="`message-signalement-${ecriture.id}`"
              >
                {{ $t('tontine.registre.qu_est_ce_qui') }}
                <InputText
                  :id="`message-signalement-${ecriture.id}`"
                  v-model="messageSignalement"
                  :placeholder="$t('tontine.registre.le_montant_ne_correspond')"
                  :data-testid="`champ-signalement-${ecriture.id}`"
                />
              </label>
              <div class="flex flex-col gap-2 pt-1 sm:flex-row">
                <Button
                  :label="signalementEnCours ? $t('commun.envoi_en_cours') : $t('tontine.registre.envoyer_le_signalement')"
                  :disabled="signalementEnCours || messageSignalement.trim().length < 5"
                  class="bg-brand text-brand-ink hover:bg-brand-strong sm:flex-1"
                  :data-testid="`bouton-envoyer-signalement-${ecriture.id}`"
                  @click="signaler(ecriture.id)"
                />
                <Button
                  :label="$t('tontine.registre.annuler')"
                  class="border border-line-strong bg-surface text-ink hover:bg-surface-muted sm:flex-1"
                  @click="signalementOuvert = null"
                />
              </div>
            </template>

            <button
              v-else
              type="button"
              class="min-h-touch self-start text-sm font-semibold text-ink-muted underline underline-offset-2 hover:text-ink"
              :data-testid="`bouton-signaler-${ecriture.id}`"
              @click="signalementOuvert = ecriture.id; messageSignalement = ''"
            >
              {{ $t('tontine.registre.signaler_une_erreur') }}
            </button>
          </div>

          <!-- Montant et canal alignés à droite, comme dans le registre du
               template : c'est la colonne que l'œil balaie pour retrouver un
               envoi. -->
          <div class="flex shrink-0 flex-col items-end gap-1">
            <AmountDisplay
              v-if="montantDe(ecriture) !== null"
              :amount="montantDe(ecriture)"
              size="sm"
            />
            <CanalPill
              v-if="canalDe(ecriture)"
              :canal="canalDe(ecriture)!"
              compact
            />
          </div>
        </li>
      </ul>

      <Button
        v-if="suite && !filtreType"
        :label="suiteEnCours ? $t('tontine.registre.chargement') : $t('tontine.registre.voir_les_ecritures_plus')"
        :disabled="suiteEnCours"
        class="border border-line-strong bg-surface text-ink hover:bg-surface-muted"
        data-testid="bouton-suite-registre"
        @click="chargerSuite"
      />
      <p
        v-else-if="suite && filtreType"
        class="text-sm text-ink-muted"
      >
        {{ $t('tontine.registre.le_filtre_porte_sur') }}
      </p>

      <!-- Contestations : le fil, pour tout le monde. -->
      <section
        v-if="litiges.length > 0"
        class="flex flex-col gap-3"
        data-testid="section-contestations"
      >
        <SectionTitle>{{ $t('tontine.registre.contestations') }}</SectionTitle>
        <ul class="flex flex-col gap-3">
          <li
            v-for="litige in litiges"
            :key="litige.dispute.id"
            class="card-surface flex flex-col gap-3 p-4"
            :data-testid="`contestation-${litige.dispute.id}`"
          >
            <div class="flex items-baseline justify-between gap-3">
              <span class="text-sm font-semibold text-ink">
                {{ $t('tontine.registre.ecriture_n_p0_p1', { p0: litige.entryPosition, p1: LIBELLE[litige.entryType] ?? litige.entryType }) }}
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
              :data-testid="`conclusion-${litige.dispute.id}`"
            >
              {{ $t('tontine.registre.conclusion_p0', { p0: litige.dispute.resolution }) }}
            </p>

            <template v-else>
              <label
                class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
                :for="`reponse-${litige.dispute.id}`"
              >
                {{ $t('tontine.registre.repondre') }}
                <InputText
                  :id="`reponse-${litige.dispute.id}`"
                  v-model="reponse[litige.dispute.id]"
                  :data-testid="`champ-reponse-${litige.dispute.id}`"
                />
              </label>
              <Button
                :label="litigeEnCours === litige.dispute.id ? $t('commun.envoi_en_cours') : $t('tontine.registre.envoyer')"
                :disabled="litigeEnCours !== null || (reponse[litige.dispute.id]?.trim().length ?? 0) < 5"
                class="border border-line-strong bg-surface text-ink hover:bg-surface-muted"
                :data-testid="`bouton-repondre-${litige.dispute.id}`"
                @click="repondre(litige.dispute.id)"
              />

              <!-- Trancher revient au président ou au censeur. -->
              <template v-if="peutTrancher">
                <label
                  class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
                  :for="`resolution-${litige.dispute.id}`"
                >
                  {{ $t('tontine.registre.conclusion_pour_clore') }}
                  <InputText
                    :id="`resolution-${litige.dispute.id}`"
                    v-model="resolution[litige.dispute.id]"
                    :data-testid="`champ-resolution-${litige.dispute.id}`"
                  />
                </label>
                <Button
                  :label="litigeEnCours === litige.dispute.id ? $t('commun.cloture_en_cours') : $t('commun.clore_la_contestation')"
                  :disabled="litigeEnCours !== null || (resolution[litige.dispute.id]?.trim().length ?? 0) < 5"
                  class="bg-brand text-brand-ink hover:bg-brand-strong"
                  :data-testid="`bouton-clore-${litige.dispute.id}`"
                  @click="clore(litige.dispute.id)"
                />
              </template>
            </template>
          </li>
        </ul>
      </section>

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
          {{ $t('tontine.registre.proces_verbal_du_dernier') }}
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
          {{ $t('tontine.registre.registre_complet_excel') }}
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
