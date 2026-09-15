<script setup lang="ts">
/**
 * Membres, parts et ordre de passage.
 *
 * Le nombre de parts est affiché explicitement, et un membre à double part
 * montre ses **deux** positions. Ce n'est pas un détail d'affichage : c'est
 * l'endroit où le bureau vérifie que la rotation correspond à ce qui a été
 * convenu de vive voix.
 */
import type { MembershipRoleId } from '#shared/constants/roles'
import { MEMBERSHIP_ROLE, ROLES_NOMMABLES } from '#shared/constants/roles'
import { managedMemberInput } from '#shared/schemas'

definePageMeta({ layout: 'app', middleware: 'auth' })
const { t } = useI18n()

const route = useRoute()
const tontineId = route.params.id as string
const session = useSessionStore()

interface Membre {
  id: string
  userId: string | null
  name: string | null
  phone: string | null
  role: 'president' | 'treasurer' | 'auditor' | 'member'
  status: 'invited' | 'pending_approval' | 'active' | 'left' | 'defaulted'
  positions: number[]
  shares: number
  /** Ce qu'il doit encore sur les tours non clos — calculé côté serveur. */
  resteDu: number
}

/** Une part, à sa place dans l'ordre de passage. */
interface Part {
  shareId: string
  rotationPosition: number
  membershipId: string
  nom: string
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
  startDate: string
  /** Ce qui empêche de démarrer — calculé par le serveur, affiché avant le clic. */
  startBlockers: Array<{ champ: string, message: string }>
} | null>(null)
const { formatDate } = useDate()
const erreur = ref<string | null>(null)

/**
 * L'ajout d'un membre géré, validé par `managedMemberInput` — le schéma du
 * serveur : trois lettres de nom, un numéro ivoirien, une à cinq parts.
 * L'erreur s'affiche sous le champ, avant l'envoi.
 */
const ajout = useFormulaire(managedMemberInput, { name: '', phone: '', shares: 1 })
const [nouveauNom, nouveauNomAttrs] = ajout.champ('name')
const [nouveauNumero, nouveauNumeroAttrs] = ajout.champ('phone')
const [nouvellesParts] = ajout.champ('shares')
const ajoutEnCours = ref(false)

const estPresident = computed(() => tontine.value?.myRole === 'president')

/**
 * Le bureau se nomme ici, et nulle part ailleurs.
 *
 * La route acceptait `role` depuis le début sans qu'aucun écran ne l'envoie :
 * chaque tontine gardait un bureau d'une seule personne, le trésorier ne
 * confirmait rien et le censeur n'existait pas. Toute la séparation des
 * pouvoirs (data-model §3) tenait sur un champ que personne ne remplissait.
 *
 * La présidence ne se donne pas par le même menu : c'est un transfert, avec sa
 * confirmation, parce que la personne à qui l'on envoie de l'argent change.
 */
const ROLES = MEMBERSHIP_ROLE
const { role: motDuRole, roleDescription } = useLibelle()
const roleChoisi = ref<Record<string, MembershipRoleId>>({})
const presidenceOuverte = ref<string | null>(null)
const defaillanceOuverte = ref<string | null>(null)

function roleDe(membre: Membre): MembershipRoleId {
  return roleChoisi.value[membre.id] ?? membre.role
}

async function nommer(membre: Membre) {
  const role = roleDe(membre)
  if (role === membre.role) return
  erreur.value = null
  decisionEnCours.value = membre.id
  try {
    await $fetch(`/api/v1/tontines/${tontineId}/members/${membre.id}`, {
      method: 'PATCH',
      body: { role },
    })
    const { [membre.id]: _retire, ...reste } = roleChoisi.value
    roleChoisi.value = reste
    await charger()
  }
  catch (e) {
    erreur.value = message(e)
  }
  finally {
    decisionEnCours.value = null
  }
}

async function passerPresidence(membreId: string) {
  erreur.value = null
  decisionEnCours.value = membreId
  try {
    await $fetch(`/api/v1/tontines/${tontineId}/members/${membreId}`, {
      method: 'PATCH',
      body: { role: 'president' },
    })
    presidenceOuverte.value = null
    // Mon propre rôle vient de changer : le cache de session doit le savoir,
    // sinon les onglets du bureau restent affichés à un simple membre.
    await session.charger(true)
    await charger()
  }
  catch (e) {
    erreur.value = message(e)
  }
  finally {
    decisionEnCours.value = null
  }
}

/**
 * Déclarer un membre défaillant — data-model §2.2.
 *
 * Le serveur n'accepte le statut qu'après un tour où le membre a pris la main ;
 * l'écran ne propose le geste que sur une tontine lancée, et dit ce qui reste
 * dû avant qu'on le pose. Aucun montant ne part en notification : rien n'est
 * publié, seul le registre en garde la trace.
 */
async function declarerDefaillant(membreId: string) {
  erreur.value = null
  decisionEnCours.value = membreId
  try {
    await $fetch(`/api/v1/tontines/${tontineId}/members/${membreId}`, {
      method: 'PATCH',
      body: { status: 'defaulted' },
    })
    defaillanceOuverte.value = null
    await charger()
  }
  catch (e) {
    erreur.value = message(e)
  }
  finally {
    decisionEnCours.value = null
  }
}

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

/**
 * Ordre de passage réordonné à la main.
 *
 * Le mode `fixed` existait côté serveur — l'ordre convenu de vive voix est le
 * cas le plus fréquent, bien avant le tirage — et aucun écran ne le proposait :
 * le président n'avait que le tirage au sort, qu'il le veuille ou non.
 *
 * On travaille sur une copie locale : tant que rien n'est enregistré, rien ne
 * bouge côté serveur, et le président peut se raviser.
 */
const ordre = ref<Part[]>([])
const ordreModifie = ref(false)
const ordreEnCours = ref(false)

function deplacer(index: number, sens: -1 | 1) {
  const cible = index + sens
  if (cible < 0 || cible >= ordre.value.length) return
  const copie = [...ordre.value]
  ;[copie[index], copie[cible]] = [copie[cible]!, copie[index]!]
  ordre.value = copie
  ordreModifie.value = true
}

async function enregistrerOrdre() {
  erreur.value = null
  ordreEnCours.value = true
  try {
    await $fetch(`/api/v1/tontines/${tontineId}/rotation`, {
      method: 'POST',
      body: { mode: 'fixed', order: ordre.value.map(p => p.shareId) },
    })
    ordreModifie.value = false
    await charger()
  }
  catch (e) {
    erreur.value = message(e)
  }
  finally {
    ordreEnCours.value = false
  }
}

/**
 * Sortie d'un membre. Le montant vient du serveur, jamais d'un calcul d'écran :
 * ce chiffre part au registre, il ne se devine pas.
 */
const sortieOuverte = ref<string | null>(null)

async function faireSortir(membreId: string) {
  erreur.value = null
  decisionEnCours.value = membreId
  try {
    await $fetch(`/api/v1/tontines/${tontineId}/members/${membreId}`, { method: 'DELETE' })
    sortieOuverte.value = null
    await charger()
  }
  catch (e) {
    erreur.value = message(e)
  }
  finally {
    decisionEnCours.value = null
  }
}

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
/**
 * Le serveur dit ce qui bloque le démarrage — le nombre de membres, une date
 * de départ déjà passée — et l'écran le répète avant le clic plutôt qu'après.
 */
const blocagesDemarrage = computed(() => tontine.value?.startBlockers ?? [])
const peutDemarrer = computed(() =>
  estPresident.value
  && tontine.value?.status === 'open'
  && blocagesDemarrage.value.length === 0,
)

function message(e: unknown): string {
  return (e as { data?: { error?: { message?: string } } })?.data?.error?.message
    ?? t('commun.serveur_injoignable')
}

async function charger() {
  etat.value = 'chargement'
  try {
    const [detail, liste] = await Promise.all([
      $fetch<typeof tontine.value>(`/api/v1/tontines/${tontineId}`),
      $fetch<{ members: Membre[], rotation: Part[] }>(`/api/v1/tontines/${tontineId}/members`),
    ])
    tontine.value = detail
    membres.value = liste.members
    ordre.value = liste.rotation
    ordreModifie.value = false
    etat.value = 'contenu'
  }
  catch (e) {
    erreur.value = message(e)
    etat.value = 'erreur'
  }
}

async function ajouter() {
  erreur.value = null
  const valeurs = await ajout.valider()
  if (!valeurs) return
  ajoutEnCours.value = true
  try {
    await $fetch(`/api/v1/tontines/${tontineId}/members`, {
      method: 'POST',
      body: valeurs,
    })
    ajout.resetForm({ values: { name: '', phone: '', shares: 1 } })
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
  titre: t('tontine.membres.membres'),
  retour: { to: `/app/tontine/${tontineId}`, label: t('commun.retour_tontine') },
}))
useHead({ title: t('tontine.membres.membres_etontine') })
</script>

<template>
  <div class="flex flex-col gap-5">
    <TontineTabs
      :tontine-id="tontineId"
      :role="(tontine?.myRole as MembershipRoleId | undefined)"
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

    <template v-else>
      <!-- Liste de cartes empilées : jamais de DataTable sous `md` (règle 11). -->
      <EmptyState
        v-if="membres.length === 0"
        :title="$t('tontine.membres.aucun_membre_pour_l')"
        :description="$t('tontine.membres.ajoute_les_membres_de')"
        icon="lucide:users"
      />

      <ul
        v-else
        class="flex flex-col gap-2"
        data-testid="liste-membres"
      >
        <!-- `template v-for` : la confirmation de sortie est un second élément
             de liste, pas un encart coincé dans la carte du membre. -->
        <template
          v-for="membre in membres"
          :key="membre.id"
        >
          <li
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
                {{ membre.name ?? $t('tontine.membres.membre_inscrit') }}
              </span>
              <!-- Le rôle est écrit, pas déduit : c'est ce qui dit à qui l'on
                   envoie l'argent et qui confirme. -->
              <span
                v-if="membre.role !== 'member'"
                class="text-xs font-semibold tracking-wide text-brand-strong uppercase"
                :data-testid="`role-${membre.id}`"
              >{{ motDuRole(membre.role, ROLES[membre.role].label) }}</span>
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
                {{ $t('tontine.membres.p0_part_p1', { p0: membre.shares, p1: membre.shares > 1 ? 's' : '' }) }}
                <template v-if="membre.positions.length > 0">
                  {{ $t('tontine.membres.position_p0_p1', { p0: membre.positions.length > 1 ? 's' : '', p1: membre.positions.join(` ${$t('tontine.membres.et')} `) }) }}
                </template>
              </span>
            </div>

            <div class="flex shrink-0 flex-col items-end gap-2">
              <StatusBadge
                kind="membership"
                :status="membre.status"
                compact
              />

              <Button
                v-if="estPresident && membre.status === 'active' && membre.role !== 'president'"
                :label="sortieOuverte === membre.id ? $t('commun.annuler') : $t('tontine.membres.faire_sortir')"
                class="border border-line-strong bg-surface text-sm text-ink hover:bg-surface-muted"
                :data-testid="`bouton-sortie-${membre.id}`"
                @click="sortieOuverte = sortieOuverte === membre.id ? null : membre.id"
              />
            </div>
          </li>

          <!-- Le bureau : rôle, présidence, défaillance. Réservé au président,
               sur les membres actifs qui ne sont pas lui. -->
          <li
            v-if="estPresident && membre.status === 'active' && membre.role !== 'president'"
            class="-mt-1 flex flex-col gap-3 rounded-b-card border border-t-0 border-line bg-surface-muted px-3 pt-3 pb-3"
            :data-testid="`bureau-${membre.id}`"
          >
            <div class="flex flex-wrap items-end gap-2">
              <label
                class="flex min-w-0 flex-1 flex-col gap-1 text-xs font-medium text-ink-muted"
                :for="`role-${membre.id}`"
              >
                {{ $t('tontine.membres.role_dans_la_tontine') }}
                <select
                  :id="`role-${membre.id}`"
                  :value="roleDe(membre)"
                  class="min-h-touch rounded-control border border-line-strong bg-surface px-3 text-sm text-ink"
                  :data-testid="`champ-role-${membre.id}`"
                  @change="roleChoisi[membre.id] = ($event.target as HTMLSelectElement).value as MembershipRoleId"
                >
                  <option
                    v-for="r in ROLES_NOMMABLES"
                    :key="r"
                    :value="r"
                  >
                    {{ motDuRole(r, ROLES[r].label) }}
                  </option>
                </select>
              </label>
              <Button
                :label="decisionEnCours === membre.id ? $t('commun.envoi_en_cours') : $t('tontine.membres.nommer')"
                :disabled="decisionEnCours !== null || roleDe(membre) === membre.role"
                class="bg-brand text-sm text-brand-ink hover:bg-brand-strong"
                :data-testid="`bouton-nommer-${membre.id}`"
                @click="nommer(membre)"
              />
            </div>
            <p class="text-xs text-ink-muted">
              {{ roleDescription(roleDe(membre), ROLES[roleDe(membre)].description) }}
              <!-- Le rôle se donne avant le compte — « il installe demain » —
                   mais ne s'exerce qu'avec lui : on le dit. -->
              <template v-if="!membre.userId">
                {{ $t('tontine.membres.sans_compte_il_ne') }}
              </template>
            </p>

            <div class="flex flex-wrap gap-2">
              <button
                v-if="membre.userId"
                type="button"
                class="min-h-touch text-left text-sm text-brand underline underline-offset-4"
                :data-testid="`bouton-presidence-${membre.id}`"
                @click="presidenceOuverte = presidenceOuverte === membre.id ? null : membre.id"
              >
                {{ presidenceOuverte === membre.id ? $t('commun.annuler') : $t('tontine.membres.lui_passer_la_presidence') }}
              </button>
              <button
                v-if="tontine?.status === 'running'"
                type="button"
                class="min-h-touch text-left text-sm text-disputed-ink underline underline-offset-4"
                :data-testid="`bouton-defaillance-${membre.id}`"
                @click="defaillanceOuverte = defaillanceOuverte === membre.id ? null : membre.id"
              >
                {{ defaillanceOuverte === membre.id ? $t('commun.annuler') : $t('tontine.membres.declarer_defaillant') }}
              </button>
            </div>
          </li>

          <li
            v-if="presidenceOuverte === membre.id"
            class="flex flex-col gap-3 rounded-card border border-declared-ink/20 bg-declared-surface p-4"
            :data-testid="`confirmation-presidence-${membre.id}`"
          >
            <p class="text-sm text-declared-ink">
              {{ $t('tontine.membres.p0_deviendra_president_c', { p0: membre.name ?? $t('tontine.membres.ce_membre') }) }}
            </p>
            <Button
              :label="decisionEnCours === membre.id ? $t('tontine.membres.transfert') : $t('tontine.membres.confirmer_le_transfert')"
              :disabled="decisionEnCours !== null"
              class="bg-brand text-brand-ink hover:bg-brand-strong"
              :data-testid="`bouton-confirmer-presidence-${membre.id}`"
              @click="passerPresidence(membre.id)"
            />
          </li>

          <li
            v-if="defaillanceOuverte === membre.id"
            class="flex flex-col gap-3 rounded-card border border-disputed-ink/20 bg-disputed-surface p-4"
            :data-testid="`confirmation-defaillance-${membre.id}`"
          >
            <p class="text-sm text-disputed-ink">
              {{ $t('tontine.membres.un_membre_defaillant_a') }}
              <template v-if="membre.resteDu > 0">
                {{ $t('tontine.membres.ce_qu_il_doit') }}
                <AmountDisplay
                  :amount="membre.resteDu"
                  size="sm"
                />
                {{ $t('tontine.membres.sera_inscrit_au_registre') }}
              </template>
              <template v-else>
                {{ $t('tontine.membres.le_registre_en_gardera') }}
              </template>
              {{ $t('tontine.membres.rien_n_est_publie') }}
            </p>
            <Button
              :label="decisionEnCours === membre.id ? $t('commun.envoi_en_cours') : $t('tontine.membres.declarer_defaillant')"
              :disabled="decisionEnCours !== null"
              class="bg-disputed-ink text-surface"
              :data-testid="`bouton-confirmer-defaillance-${membre.id}`"
              @click="declarerDefaillant(membre.id)"
            />
          </li>

          <!-- Ce qu'une sortie laisse derrière elle, dit avant de la faire.
             Le montant vient du serveur : il partira au registre tel quel. -->
          <li
            v-if="sortieOuverte === membre.id"
            class="flex flex-col gap-3 rounded-card border border-disputed-ink/20 bg-disputed-surface p-4"
            :data-testid="`confirmation-sortie-${membre.id}`"
          >
            <p class="text-sm text-disputed-ink">
              <template v-if="membre.resteDu > 0">
                {{ $t('tontine.membres.p0_doit_encore', { p0: membre.name ?? $t('tontine.membres.ce_membre') }) }}
                <AmountDisplay
                  :amount="membre.resteDu"
                  size="sm"
                />
                {{ $t('tontine.membres.sur_les_tours_en') }}
              </template>
              <template v-else>
                {{ $t('tontine.membres.p0_ne_doit_rien', { p0: membre.name ?? $t('tontine.membres.ce_membre') }) }}
              </template>
            </p>

            <Button
              :label="decisionEnCours === membre.id ? $t('tontine.membres.sortie') : $t('tontine.membres.confirmer_la_sortie')"
              :disabled="decisionEnCours !== null"
              class="bg-brand text-brand-ink hover:bg-brand-strong"
              :data-testid="`bouton-confirmer-sortie-${membre.id}`"
              @click="faireSortir(membre.id)"
            />
          </li>
        </template>
      </ul>

      <p
        v-if="tontine"
        class="text-sm text-ink-muted"
        data-testid="total-parts"
      >
        {{ $t('tontine.membres.p0_parts_au_total', { p0: tontine.totalShares }) }}
        <AmountDisplay :amount="tontine.expectedPot" />
      </p>

      <!-- Demandes d'adhésion arrivées par lien -->
      <section
        v-if="estPresident && enAttente.length > 0"
        class="flex flex-col gap-3 card-surface p-4"
        data-testid="section-adhesions"
      >
        <h2 class="font-semibold text-ink">
          {{ $t('tontine.membres.demandes_d_adhesion') }}
        </h2>
        <p class="text-sm text-ink-muted">
          {{ $t('tontine.membres.ces_personnes_ont_ouvert') }}
        </p>

        <ul class="flex flex-col gap-3">
          <li
            v-for="membre in enAttente"
            :key="membre.id"
            class="flex flex-col gap-2 rounded-control border border-line p-3"
            :data-testid="`adhesion-${membre.id}`"
          >
            <span class="font-semibold text-ink">
              {{ membre.name ?? $t('tontine.membres.membre_inscrit') }}
            </span>
            <span
              v-if="membre.phone"
              class="tabular text-sm text-ink-muted"
            >{{ membre.phone }}</span>

            <label
              class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
              :for="`parts-adhesion-${membre.id}`"
            >
              {{ $t('tontine.membres.nombre_de_parts') }}
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
                :label="decisionEnCours === membre.id ? $t('tontine.membres.enregistrement') : $t('tontine.membres.approuver')"
                :disabled="decisionEnCours !== null"
                class="bg-brand text-brand-ink hover:bg-brand-strong sm:flex-1"
                :data-testid="`bouton-approuver-${membre.id}`"
                @click="decider(membre.id, 'active')"
              />
              <Button
                :label="$t('tontine.membres.refuser')"
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
          {{ $t('tontine.membres.ajouter_un_membre') }}
        </h2>
        <p class="text-sm text-ink-muted">
          {{ $t('tontine.membres.pour_quelqu_un_qui') }}
        </p>

        <label
          class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
          for="nom-membre"
        >
          {{ $t('tontine.membres.nom') }}
          <InputText
            id="nom-membre"
            v-model="nouveauNom"
            v-bind="nouveauNomAttrs"
            :aria-invalid="Boolean(ajout.erreur('name'))"
            data-testid="champ-nom-membre"
          />
          <ErreurChamp :message="ajout.erreur('name')" />
        </label>
        <label
          class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
          for="numero-membre"
        >
          {{ $t('tontine.membres.numero') }}
          <InputText
            id="numero-membre"
            v-model="nouveauNumero"
            v-bind="nouveauNumeroAttrs"
            inputmode="tel"
            placeholder="07 07 12 34 56"
            :aria-invalid="Boolean(ajout.erreur('phone'))"
            data-testid="champ-numero-membre"
          />
          <ErreurChamp :message="ajout.erreur('phone')" />
        </label>
        <label
          class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
          for="parts-membre"
        >
          {{ $t('tontine.membres.nombre_de_parts') }}
          <InputText
            id="parts-membre"
            :value="nouvellesParts"
            inputmode="numeric"
            :aria-invalid="Boolean(ajout.erreur('shares'))"
            data-testid="champ-parts-membre"
            @input="nouvellesParts = Number(($event.target as HTMLInputElement).value.replace(/\D/g, '')) || 1"
          />
          <ErreurChamp :message="ajout.erreur('shares')" />
          <span class="text-sm font-normal text-ink-subtle">
            {{ $t('tontine.membres.deux_parts_deux_positions') }}
          </span>
        </label>

        <Button
          :label="ajoutEnCours ? $t('tontine.membres.ajout') : $t('tontine.membres.ajouter')"
          :disabled="ajoutEnCours || (nouveauNom ?? '').length < 3 || (nouveauNumero ?? '').length < 8"
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
          {{ $t('tontine.membres.inviter') }}
        </h2>

        <Button
          v-if="!invitation"
          :label="$t('tontine.membres.creer_un_lien_d')"
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

      <!-- Ordre de passage — à la main, ou au sort -->
      <section
        v-if="estPresident && tontine?.status === 'open' && ordre.length > 0"
        class="flex flex-col gap-3 card-surface p-4"
        data-testid="section-ordre"
      >
        <h2 class="font-semibold text-ink">
          {{ $t('tontine.membres.ordre_de_passage') }}
        </h2>
        <p class="text-sm text-ink-muted">
          {{ $t('tontine.membres.l_ordre_convenu_entre') }}
        </p>

        <ul class="flex flex-col gap-2">
          <li
            v-for="(part, index) in ordre"
            :key="part.shareId"
            class="flex items-center gap-3 rounded-control border border-line p-2"
            :data-testid="`ordre-${index + 1}`"
          >
            <span
              class="tabular flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-surface text-xs font-bold text-brand-strong"
              aria-hidden="true"
            >{{ index + 1 }}</span>
            <span class="min-w-0 flex-1 truncate text-sm font-medium text-ink">{{ part.nom }}</span>

            <Button
              :disabled="index === 0"
              class="border border-line-strong bg-surface text-ink hover:bg-surface-muted"
              :aria-label="$t('tontine.membres.faire_monter', { nom: part.nom })"
              :data-testid="`monter-${part.shareId}`"
              @click="deplacer(index, -1)"
            >
              <Icon
                name="lucide:chevron-up"
                size="1rem"
                aria-hidden="true"
              />
            </Button>
            <Button
              :disabled="index === ordre.length - 1"
              class="border border-line-strong bg-surface text-ink hover:bg-surface-muted"
              :aria-label="$t('tontine.membres.faire_descendre', { nom: part.nom })"
              :data-testid="`descendre-${part.shareId}`"
              @click="deplacer(index, 1)"
            >
              <Icon
                name="lucide:chevron-down"
                size="1rem"
                aria-hidden="true"
              />
            </Button>
          </li>
        </ul>

        <Button
          v-if="ordreModifie"
          :label="ordreEnCours ? $t('tontine.membres.enregistrement') : $t('tontine.membres.enregistrer_cet_ordre')"
          :disabled="ordreEnCours"
          class="bg-brand text-brand-ink hover:bg-brand-strong"
          data-testid="bouton-enregistrer-ordre"
          @click="enregistrerOrdre"
        />
      </section>

      <div
        v-if="estPresident && tontine?.status === 'open'"
        class="mt-auto flex flex-col gap-2 pt-2"
      >
        <!-- La date du premier tour, dite avant de démarrer : c'est d'elle
             que toutes les échéances découlent, et elle a pu passer pendant
             que le groupe se remplissait. -->
        <p
          class="flex items-center gap-2 rounded-control bg-surface-muted p-3 text-sm text-ink-muted"
          data-testid="date-premier-tour"
        >
          <Icon
            name="lucide:calendar"
            size="1rem"
            class="shrink-0"
            aria-hidden="true"
          />
          <span>
            {{ $t('tontine.membres.premier_tour_le') }} <strong class="font-semibold text-ink">{{ formatDate(tontine.startDate) }}</strong>
          </span>
          <NuxtLink
            :to="`/app/tontine/${tontineId}/reglages`"
            class="ml-auto min-h-touch inline-flex items-center font-semibold text-brand"
            data-testid="lien-changer-date"
          >
            {{ $t('tontine.membres.changer') }}
          </NuxtLink>
        </p>

        <ul
          v-if="blocagesDemarrage.length > 0"
          class="flex flex-col gap-2"
          data-testid="blocages-demarrage"
        >
          <li
            v-for="blocage in blocagesDemarrage"
            :key="blocage.champ"
            class="flex items-start gap-2 rounded-control bg-late-surface p-3 text-sm text-late-ink"
          >
            <Icon
              name="lucide:triangle-alert"
              size="1rem"
              class="mt-0.5 shrink-0"
              aria-hidden="true"
            />
            {{ blocage.message }}
          </li>
        </ul>

        <Button
          :label="$t('tontine.membres.tirer_l_ordre_au')"
          class="border border-line-strong bg-surface text-ink hover:bg-surface-muted"
          data-testid="bouton-tirage"
          @click="tirerAuSort"
        />
        <Button
          :label="$t('tontine.membres.demarrer_la_tontine')"
          :disabled="!peutDemarrer"
          class="bg-brand text-brand-ink hover:bg-brand-strong"
          data-testid="bouton-demarrer"
          @click="demarrer"
        />
        <p class="text-sm text-ink-subtle">
          {{ $t('tontine.membres.au_demarrage_l_ordre') }}
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
