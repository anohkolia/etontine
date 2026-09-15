<script setup lang="ts">
/**
 * Cotiser : récapitulatif → où envoyer → déclaration.
 *
 * Trois étapes qui suivent le geste réel : le membre regarde ce qu'il doit,
 * part envoyer dans son application de paiement, puis revient dire qu'il l'a
 * fait. L'application ne touche jamais l'argent (règle 5) — elle enregistre une
 * déclaration, que le trésorier confirmera.
 *
 * **Un membre à deux parts a deux cotisations** : l'écran les liste toutes, et
 * n'en masque aucune. En montrer une seule le laisserait croire qu'il est à
 * jour alors qu'il doit encore la moitié.
 */
import { declareContributionInput } from '#shared/schemas'

definePageMeta({ layout: 'app', middleware: 'auth' })
const { t } = useI18n()

const route = useRoute()
const tontineId = route.params.id as string
const { compresser } = useCompressionImage()

// Le seul écran que la file de mutations couvre : c'est ici, et nulle part
// ailleurs, que le bandeau peut promettre qu'une saisie faite sans réseau
// partira toute seule.
useNatureHorsLigne(() => 'saisie')
const { envoyerOuEnfiler } = useFileHorsLigne()
const enLigne = useOnline()

interface Cotisation {
  id: string
  rotationPosition: number
  expectedAmount: number
  confirmedAmount: number
  status: 'due' | 'late' | 'declared' | 'confirmed' | 'disputed'
  dueDate: string
}

interface Canal {
  id: string
  provider: string
  msisdn: string
  holderName: string
  paymentLinkUrl: string | null
  frozenUntil: string | null
}
interface InfoPaiement {
  expectedAmount: number
  reference: string
  channels: Canal[]
}

const etat = ref<'chargement' | 'contenu' | 'erreur' | 'vide'>('chargement')
const erreur = ref<string | null>(null)
const tour = ref<{ index: number, dueDate: string } | null>(null)
const cotisations = ref<Cotisation[]>([])

const etape = ref('1')
const choisie = ref<string | null>(null)
const info = ref<InfoPaiement | null>(null)

/**
 * La déclaration, validée par `declareContributionInput` — le schéma du
 * serveur : un montant entier et positif, un canal connu, une référence de
 * soixante-quatre caractères au plus. La preuve est ajoutée après dépôt.
 */
const formulaireDeclaration = useFormulaire(declareContributionInput, {
  amount: 0,
  channel: 'wave',
  providerRef: undefined,
})
const [montantDeclare] = formulaireDeclaration.champ('amount')
const [canalDeclare, canalDeclareAttrs] = formulaireDeclaration.champ('channel')
const [reference, referenceAttrs] = formulaireDeclaration.champ('providerRef')
const preuve = ref<File | null>(null)
const poidsPreuve = ref<number | null>(null)
const envoi = ref(false)
const messageDeclaration = ref<string | null>(null)

/**
 * Verrou anti-double-déclaration.
 *
 * Le bouton reste inactif 90 secondes après un envoi réussi (acceptation T15).
 * C'est plus long qu'un réseau qui rame, et plus court qu'un aller-retour réel
 * vers l'application de paiement : un second envoi légitime dépassera
 * largement ce délai.
 */
const VERROU_SECONDES = 90
const verrou = ref(0)
let minuterie: ReturnType<typeof setInterval> | undefined

function demarrerVerrou() {
  verrou.value = VERROU_SECONDES
  clearInterval(minuterie)
  minuterie = setInterval(() => {
    verrou.value--
    if (verrou.value <= 0) clearInterval(minuterie)
  }, 1000)
}

onBeforeUnmount(() => clearInterval(minuterie))

/**
 * Un versement enregistré **pour moi** par le bureau, que je n'ai pas déclaré.
 *
 * C'est le pendant de la déclaration d'espèces, et il manquait entièrement : le
 * trésorier pouvait porter un versement à mon nom, ma cotisation passait en
 * « déclarée », et je n'avais aucun moyen de dire si je le reconnais. Le
 * contrôle qui rend cette dissymétrie acceptable ne servait à rien tant que
 * personne ne pouvait l'exercer.
 */
interface DeclarationEnAttente {
  id: string
  contributionId: string
  amount: number
  channel: string
  source: 'member' | 'treasurer' | 'system'
  declaredAt: string
  declaredBy: string
  proofUrl: string | null
  memberAcknowledgedAt: string | null
  decision: 'pending' | 'confirmed' | 'rejected'
  decidedAt: string | null
  rejectionReason: string | null
}

const declarations = ref<DeclarationEnAttente[]>([])
const motifContestation = ref<Record<string, string>>({})
const contestationOuverte = ref<string | null>(null)
const decisionEnCours = ref<string | null>(null)

/** Celles que je n'ai ni faites ni encore reconnues, et qui attendent encore. */
const aReconnaitre = computed(() =>
  declarations.value.filter(d =>
    d.source === 'treasurer' && d.decision === 'pending' && !d.memberAcknowledgedAt,
  ),
)

/**
 * Les rejets, avec leur motif.
 *
 * Le motif est obligatoire au rejet, il est enregistré, et la notification
 * renvoie ici « pour voir le motif ». Il n'arrivait jamais : `my-contributions`
 * ne remontait que les déclarations en attente. Le membre voyait le badge
 * « Contesté » et devait deviner ce qui clochait — donc renvoyait la même
 * chose, et se faisait rejeter une seconde fois.
 */
/**
 * Le reçu d'une cotisation confirmée.
 *
 * Le lien signé, sa vérification en temps constant, la page publique et
 * l'image sous 40 Ko pour WhatsApp étaient tous écrits et testés — et
 * `POST /declarations/:id/receipt-link` n'avait aucun appelant. Rien ne menait
 * à `/recu/`. Le membre ne pouvait pas montrer une preuve de ce qu'il avait
 * versé, ce qui est pourtant la première chose qu'on demande dans une tontine.
 */
const { copier, copie } = useCopie()
const recus = ref<Record<string, string>>({})
const recuEnCours = ref<string | null>(null)

function confirmeeDe(contributionId: string) {
  return declarations.value.find(d => d.contributionId === contributionId && d.decision === 'confirmed')
    ?? null
}

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

/**
 * Ma déclaration en attente sans capture, sur une cotisation donnée.
 *
 * Déclarée sans réseau, la capture n'était pas partie — et rien ne permettait
 * de la joindre ensuite, alors que l'écran le promettait. Tant que le
 * trésorier ne s'est pas prononcé, l'auteur peut la joindre, une fois.
 */
const session = useSessionStore()

function sansPreuveDe(contributionId: string) {
  return declarations.value.find(d =>
    d.contributionId === contributionId
    && d.decision === 'pending'
    && d.declaredBy === session.user?.id
    && !d.proofUrl,
  ) ?? null
}

const preuveEnCours = ref<string | null>(null)

async function joindrePreuve(declarationId: string, evenement: Event) {
  const fichier = (evenement.target as HTMLInputElement).files?.[0]
  if (!fichier) return
  erreur.value = null
  preuveEnCours.value = declarationId
  try {
    const compresse = await compresser(fichier)
    const formulaire = new FormData()
    formulaire.append('file', compresse)
    const depot = await $fetch<{ url: string }>('/api/v1/uploads/proof', { method: 'POST', body: formulaire })
    await $fetch(`/api/v1/declarations/${declarationId}/proof`, { method: 'POST', body: { proofUrl: depot.url } })
    await charger()
  }
  catch (e) {
    erreur.value = message(e)
  }
  finally {
    preuveEnCours.value = null
  }
}

function rejetDe(contributionId: string) {
  return declarations.value.find(d => d.contributionId === contributionId && d.decision === 'rejected')
    ?? null
}

async function reconnaitre(declarationId: string) {
  erreur.value = null
  decisionEnCours.value = declarationId
  try {
    await $fetch(`/api/v1/declarations/${declarationId}/acknowledge`, { method: 'POST' })
    await charger()
  }
  catch (e) {
    erreur.value = message(e)
  }
  finally {
    decisionEnCours.value = null
  }
}

async function contester(declarationId: string) {
  erreur.value = null
  decisionEnCours.value = declarationId
  try {
    await $fetch(`/api/v1/declarations/${declarationId}/reject`, {
      method: 'POST',
      body: { reason: motifContestation.value[declarationId] },
    })
    contestationOuverte.value = null
    await charger()
  }
  catch (e) {
    erreur.value = message(e)
  }
  finally {
    decisionEnCours.value = null
  }
}

const cotisationChoisie = computed(() => cotisations.value.find(c => c.id === choisie.value) ?? null)
const restantTotal = computed(() =>
  cotisations.value.reduce((n, c) => n + Math.max(0, c.expectedAmount - c.confirmedAmount), 0),
)

function message(e: unknown): string {
  return (e as { data?: { error?: { message?: string } } })?.data?.error?.message
    ?? t('commun.serveur_injoignable')
}

async function charger() {
  etat.value = 'chargement'
  try {
    const reponse = await $fetch<{
      round: { index: number, dueDate: string } | null
      contributions: Cotisation[]
      declarations: DeclarationEnAttente[]
    }>(
      `/api/v1/tontines/${tontineId}/my-contributions`,
    )
    tour.value = reponse.round
    cotisations.value = reponse.contributions
    declarations.value = reponse.declarations ?? []
    etat.value = reponse.round ? 'contenu' : 'vide'
  }
  catch (e) {
    // Hors-ligne est un état à part entière, distinct de l'erreur (règle 14).
    // Sans cette distinction, une coupure réseau après une déclaration mise en
    // file remplacerait la confirmation par un écran d'erreur — et le membre
    // croirait que sa saisie est perdue, alors qu'elle attend simplement.
    if (!navigator.onLine && cotisations.value.length > 0) {
      etat.value = 'contenu'
      return
    }
    erreur.value = message(e)
    etat.value = 'erreur'
  }
}

async function choisir(id: string) {
  choisie.value = id
  info.value = await $fetch<InfoPaiement>(`/api/v1/contributions/${id}/payment-info`)
  formulaireDeclaration.resetForm({ values: { amount: info.value.expectedAmount, channel: 'wave', providerRef: undefined } })
  etape.value = '2'
}

async function choisirFichier(evenement: Event) {
  const fichier = (evenement.target as HTMLInputElement).files?.[0]
  if (!fichier) return

  try {
    // Compression **avant** l'envoi : une photo brute de téléphone pèse
    // plusieurs mégaoctets, et sur un forfait à la donnée cela coûte au membre.
    const compresse = await compresser(fichier)
    preuve.value = compresse
    poidsPreuve.value = compresse.size
  }
  catch (e) {
    erreur.value = (e as Error).message
  }
}

async function declarer() {
  if (!cotisationChoisie.value) return

  messageDeclaration.value = null
  erreur.value = null
  // Une référence vide n'est pas une référence : on ne l'envoie pas.
  if (!reference.value?.trim()) formulaireDeclaration.setFieldValue('providerRef', undefined, false)
  const valeurs = await formulaireDeclaration.valider()
  if (!valeurs) return
  envoi.value = true

  try {
    let proofUrl: string | undefined
    // Le dépôt d'image ne se met pas en file : une preuve de plusieurs dizaines
    // de kilo-octets dans IndexedDB, multipliée par les tentatives, remplirait
    // le stockage du téléphone. La déclaration part sans, et le membre pourra
    // joindre la capture ensuite.
    if (preuve.value && enLigne.value) {
      const formulaire = new FormData()
      formulaire.append('file', preuve.value)
      const depot = await $fetch<{ url: string }>('/api/v1/uploads/proof', {
        method: 'POST',
        body: formulaire,
      })
      proofUrl = depot.url
    }
    else if (preuve.value && !enLigne.value) {
      erreur.value = t('tontine.cotiser.la_capture_ne_peut')
    }

    // La clé d'idempotence est fabriquée **ici**, au moment de la saisie, et
    // voyage avec l'intention : que l'envoi parte maintenant ou dans une heure
    // au retour du réseau, le serveur ne créera qu'une seule déclaration.
    const { partie, reponse } = await envoyerOuEnfiler({
      url: `/api/v1/contributions/${cotisationChoisie.value.id}/declare`,
      method: 'POST',
      idempotencyKey: crypto.randomUUID(),
      libelle: t('tontine.cotiser.declaration_de_cotisation_tour', { n: tour.value?.index }),
      body: {
        amount: valeurs.amount,
        channel: valeurs.channel,
        providerRef: valeurs.providerRef,
        proofUrl,
      },
    })

    // Sur une tontine où le bureau n'a qu'un membre, le serveur confirme la
    // déclaration dans la foulée : il n'y a personne d'autre pour le faire.
    // Annoncer un trésorier qui va la confirmer serait annoncer une attente
    // qui n'arrivera jamais.
    const auto = (reponse as { autoConfirmee?: boolean } | undefined)?.autoConfirmee === true

    messageDeclaration.value = !partie
      ? t('tontine.cotiser.pas_de_reseau_ta')
      : auto
        ? t('tontine.cotiser.cotisation_enregistree_et_confirmee')
        : t('tontine.cotiser.declaration_enregistree_le_tresorier')

    demarrerVerrou()
    preuve.value = null
    poidsPreuve.value = null

    // Sans réseau, il n'y a rien de neuf à recharger : le statut ne changera
    // qu'à l'envoi effectif. On garde l'écran tel quel.
    if (partie) await charger()

    // On revient au récapitulatif : le membre doit voir son statut changer,
    // pas rester sur un formulaire qu'il vient d'envoyer.
    etape.value = '1'
  }
  catch (e) {
    const err = e as { data?: { error?: { code?: string, message?: string } } }
    // Une seconde déclaration sur une cotisation déjà déclarée : message
    // explicite, jamais un doublon silencieux.
    messageDeclaration.value = err.data?.error?.code === 'INVALID_TRANSITION'
      ? t('tontine.cotiser.cette_cotisation_a_deja')
      : (err.data?.error?.message ?? t('tontine.cotiser.impossible_d_enregistrer_la'))
  }
  finally {
    envoi.value = false
  }
}

onMounted(charger)
useEnTete(() => ({
  titre: t('tontine.cotiser.cotiser'),
  retour: { to: `/app/tontine/${tontineId}`, label: t('commun.retour_tontine') },
}))
useHead({ title: t('tontine.cotiser.cotiser_etontine') })
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
      :title="$t('tontine.cotiser.aucun_tour_ouvert')"
      :description="$t('tontine.cotiser.il_n_y_a')"
      icon="lucide:calendar"
    />

    <template v-else>
      <p
        v-if="messageDeclaration"
        role="status"
        class="rounded-control bg-declared-surface p-3 text-sm text-declared-ink"
        data-testid="message-declaration"
      >
        {{ messageDeclaration }}
      </p>

      <Stepper v-model:value="etape">
        <StepList>
          <Step value="1">
            {{ $t('tontine.cotiser.recapitulatif') }}
          </Step>
          <Step value="2">
            {{ $t('tontine.cotiser.ou_envoyer') }}
          </Step>
          <Step value="3">
            {{ $t('tontine.cotiser.declaration') }}
          </Step>
        </StepList>

        <StepPanels>
          <!-- Étape 1 — ce que je dois -->
          <StepPanel value="1">
            <div class="flex flex-col gap-3">
              <p class="text-sm text-ink-muted">
                {{ $t('tontine.cotiser.tour_p0_a_verser', { p0: tour?.index, p1: tour?.dueDate }) }}
              </p>

              <p
                v-if="cotisations.length > 1"
                class="rounded-control bg-declared-surface p-3 text-sm text-declared-ink"
                data-testid="avertissement-parts-multiples"
              >
                {{ $t('tontine.cotiser.tu_as_p0_parts', { p0: cotisations.length, p1: cotisations.length }) }}
              </p>

              <!-- Un versement enregistré pour moi, que je n'ai pas déclaré.
                   Je dois pouvoir dire si je le reconnais — sinon le bureau
                   peut porter au registre un versement qui n'a pas eu lieu. -->
              <section
                v-for="declaration in aReconnaitre"
                :key="declaration.id"
                class="flex flex-col gap-3 rounded-card border border-declared-ink/20 bg-declared-surface p-4"
                :data-testid="`a-reconnaitre-${declaration.id}`"
              >
                <p class="flex items-start gap-2 text-sm text-declared-ink">
                  <Icon
                    name="lucide:hand-coins"
                    size="1rem"
                    class="mt-0.5 shrink-0"
                    aria-hidden="true"
                  />
                  <span>
                    {{ $t('tontine.cotiser.le_bureau_a_enregistre') }}
                    <AmountDisplay
                      :amount="declaration.amount"
                      size="sm"
                    />
                    {{ $t('tontine.cotiser.a_ton_nom_est') }}
                  </span>
                </p>

                <template v-if="contestationOuverte === declaration.id">
                  <label
                    class="flex flex-col gap-1.5 text-sm font-medium text-declared-ink"
                    :for="`motif-contestation-${declaration.id}`"
                  >
                    {{ $t('tontine.cotiser.qu_est_ce_qui') }}
                    <InputText
                      :id="`motif-contestation-${declaration.id}`"
                      v-model="motifContestation[declaration.id]"
                      :placeholder="$t('tontine.cotiser.je_n_ai_rien')"
                      :data-testid="`champ-motif-contestation-${declaration.id}`"
                    />
                  </label>
                  <Button
                    :label="decisionEnCours === declaration.id ? $t('commun.envoi_en_cours') : $t('tontine.cotiser.envoyer_la_contestation')"
                    :disabled="decisionEnCours !== null
                      || (motifContestation[declaration.id]?.trim().length ?? 0) < 5"
                    class="bg-brand text-brand-ink hover:bg-brand-strong"
                    :data-testid="`bouton-contester-${declaration.id}`"
                    @click="contester(declaration.id)"
                  />
                </template>

                <div
                  v-else
                  class="flex flex-col gap-2 sm:flex-row"
                >
                  <Button
                    :label="decisionEnCours === declaration.id ? $t('commun.envoi_en_cours') : $t('tontine.cotiser.oui_c_est_exact')"
                    :disabled="decisionEnCours !== null"
                    class="bg-brand text-brand-ink hover:bg-brand-strong sm:flex-1"
                    :data-testid="`bouton-reconnaitre-${declaration.id}`"
                    @click="reconnaitre(declaration.id)"
                  />
                  <Button
                    :label="$t('tontine.cotiser.non_ce_n_est')"
                    :disabled="decisionEnCours !== null"
                    class="border border-line-strong bg-surface text-ink hover:bg-surface-muted sm:flex-1"
                    :data-testid="`bouton-ouvrir-contestation-${declaration.id}`"
                    @click="contestationOuverte = declaration.id"
                  />
                </div>
              </section>

              <ul
                class="flex flex-col gap-2"
                data-testid="liste-cotisations"
              >
                <li
                  v-for="cotisation in cotisations"
                  :key="cotisation.id"
                  class="flex flex-col gap-3 card-surface p-3"
                  :data-testid="`cotisation-${cotisation.id}`"
                >
                  <div class="flex items-center justify-between gap-3">
                    <div class="flex flex-col gap-1">
                      <span class="text-sm text-ink-muted">
                        {{ $t('tontine.cotiser.part_en_position_p0', { p0: cotisation.rotationPosition }) }}
                      </span>
                      <AmountDisplay
                        :amount="cotisation.expectedAmount - cotisation.confirmedAmount"
                        size="lg"
                      />
                    </div>

                    <div class="flex flex-col items-end gap-2">
                      <StatusBadge
                        kind="contribution"
                        :status="cotisation.status"
                        compact
                      />
                      <Button
                        v-if="cotisation.status === 'due' || cotisation.status === 'late'"
                        :label="$t('tontine.cotiser.envoyer')"
                        class="bg-brand text-brand-ink hover:bg-brand-strong"
                        :data-testid="`bouton-envoyer-${cotisation.id}`"
                        @click="choisir(cotisation.id)"
                      />
                    </div>
                  </div>

                  <!-- Confirmée : le reçu. C'est la preuve qu'on demande quand
                       quelqu'un conteste, des mois plus tard. -->
                  <div
                    v-if="cotisation.status === 'confirmed' && confirmeeDe(cotisation.id)"
                    class="flex flex-col gap-2"
                  >
                    <template v-if="recus[confirmeeDe(cotisation.id)!.id]">
                      <p class="text-sm text-ink-muted">
                        {{ $t('tontine.cotiser.ce_lien_vaut_preuve') }}
                      </p>
                      <div class="flex flex-col gap-2 sm:flex-row">
                        <a
                          :href="recus[confirmeeDe(cotisation.id)!.id]"
                          target="_blank"
                          rel="noopener"
                          class="min-h-touch inline-flex flex-1 items-center justify-center rounded-control border border-line-strong bg-surface px-4 text-sm font-semibold text-ink"
                          :data-testid="`lien-recu-${cotisation.id}`"
                        >
                          {{ $t('tontine.cotiser.ouvrir_le_recu') }}
                        </a>
                        <Button
                          :label="copie ? $t('commun.copie') : $t('commun.copier_le_lien')"
                          class="border border-line-strong bg-surface text-ink hover:bg-surface-muted sm:flex-1"
                          :data-testid="`bouton-copier-recu-${cotisation.id}`"
                          @click="copier(recus[confirmeeDe(cotisation.id)!.id]!)"
                        />
                      </div>
                    </template>

                    <Button
                      v-else
                      :label="recuEnCours === confirmeeDe(cotisation.id)!.id ? $t('commun.preparation_en_cours') : $t('tontine.cotiser.obtenir_mon_recu')"
                      :disabled="recuEnCours !== null"
                      class="border border-line-strong bg-surface text-ink hover:bg-surface-muted"
                      :data-testid="`bouton-recu-${cotisation.id}`"
                      @click="obtenirRecu(confirmeeDe(cotisation.id)!.id)"
                    />
                  </div>

                  <!-- Déclarée sans capture — hors réseau, ou sans y penser :
                       on peut la joindre tant que le trésorier n'a pas tranché. -->
                  <label
                    v-if="cotisation.status === 'declared' && sansPreuveDe(cotisation.id)"
                    class="flex min-h-touch cursor-pointer items-center gap-2 text-sm font-semibold text-brand underline underline-offset-4"
                    :for="`preuve-tardive-${cotisation.id}`"
                  >
                    <Icon
                      name="lucide:paperclip"
                      size="1rem"
                      aria-hidden="true"
                    />
                    {{ preuveEnCours === sansPreuveDe(cotisation.id)!.id ? $t('tontine.cotiser.envoi_de_la_capture') : $t('tontine.cotiser.joindre_la_capture_de') }}
                    <input
                      :id="`preuve-tardive-${cotisation.id}`"
                      type="file"
                      accept="image/*"
                      class="sr-only"
                      :disabled="preuveEnCours !== null"
                      :data-testid="`champ-preuve-tardive-${cotisation.id}`"
                      @change="joindrePreuve(sansPreuveDe(cotisation.id)!.id, $event)"
                    >
                  </label>
                  <p
                    v-else-if="cotisation.status === 'declared' && declarations.find(d => d.contributionId === cotisation.id && d.decision === 'pending')?.proofUrl"
                    class="flex items-center gap-2 text-sm text-ink-muted"
                    :data-testid="`preuve-jointe-${cotisation.id}`"
                  >
                    <Icon
                      name="lucide:paperclip"
                      size="1rem"
                      aria-hidden="true"
                    />
                    {{ $t('tontine.cotiser.capture_jointe') }}
                  </p>

                  <!-- « Contesté » sans le motif ne dit pas quoi corriger : on
                       renvoie la même chose, et on se fait rejeter à nouveau. -->
                  <p
                    v-if="cotisation.status === 'disputed' && rejetDe(cotisation.id)"
                    class="flex items-start gap-2 rounded-control bg-disputed-surface p-3 text-sm text-disputed-ink"
                    :data-testid="`motif-rejet-${cotisation.id}`"
                  >
                    <Icon
                      name="lucide:octagon-alert"
                      size="1rem"
                      class="mt-0.5 shrink-0"
                      aria-hidden="true"
                    />
                    <span>
                      <strong class="font-semibold">{{ $t('tontine.cotiser.ta_declaration_a_ete') }}</strong>
                      {{ rejetDe(cotisation.id)?.rejectionReason }}
                    </span>
                  </p>
                </li>
              </ul>

              <p class="text-sm text-ink-muted">
                {{ $t('tontine.cotiser.total_restant_a_verser') }}
                <AmountDisplay :amount="restantTotal" />
              </p>
            </div>
          </StepPanel>

          <!-- Étape 2 — où envoyer -->
          <StepPanel value="2">
            <div class="flex flex-col gap-4">
              <OuEnvoyer
                v-if="info"
                :expected-amount="info.expectedAmount"
                :reference="info.reference"
                :channels="info.channels"
              />

              <Button
                :label="$t('tontine.cotiser.j_ai_envoye')"
                class="bg-brand text-brand-ink hover:bg-brand-strong"
                data-testid="bouton-jai-envoye"
                @click="etape = '3'"
              />
            </div>
          </StepPanel>

          <!-- Étape 3 — déclaration -->
          <StepPanel value="3">
            <div class="flex flex-col gap-4">
              <p class="text-base text-ink">
                {{ $t('tontine.cotiser.as_tu_bien_envoye') }}
              </p>
              <p class="text-sm text-ink-muted">
                {{ $t('tontine.cotiser.declare_ton_envoi_le') }}
              </p>

              <label
                class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
                for="montant-declare"
              >
                {{ $t('tontine.cotiser.montant_envoye_fcfa') }}
                <InputText
                  id="montant-declare"
                  :value="montantDeclare"
                  inputmode="numeric"
                  :aria-invalid="Boolean(formulaireDeclaration.erreur('amount'))"
                  data-testid="champ-montant-declare"
                  @input="montantDeclare = Number(($event.target as HTMLInputElement).value.replace(/\D/g, '')) || 0"
                />
                <ErreurChamp :message="formulaireDeclaration.erreur('amount')" />
              </label>

              <label
                class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
                for="canal-declare"
              >
                {{ $t('tontine.cotiser.par_quel_moyen') }}
                <select
                  id="canal-declare"
                  v-model="canalDeclare"
                  v-bind="canalDeclareAttrs"
                  class="min-h-touch rounded-control border border-line-strong bg-surface px-3 text-base text-ink"
                  data-testid="champ-canal-declare"
                >
                  <option value="wave">{{ $t('tontine.cotiser.wave') }}</option>
                  <option value="orange">{{ $t('tontine.cotiser.orange_money') }}</option>
                  <option value="mtn">{{ $t('tontine.cotiser.mtn_momo') }}</option>
                  <option value="moov">{{ $t('tontine.cotiser.moov_money') }}</option>
                  <option value="cash">{{ $t('tontine.cotiser.especes') }}</option>
                </select>
              </label>

              <label
                class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
                for="reference-transaction"
              >
                {{ $t('tontine.cotiser.reference_de_la_transaction') }}
                <InputText
                  id="reference-transaction"
                  v-model="reference"
                  v-bind="referenceAttrs"
                  maxlength="64"
                  :aria-invalid="Boolean(formulaireDeclaration.erreur('providerRef'))"
                  data-testid="champ-reference-transaction"
                />
                <ErreurChamp :message="formulaireDeclaration.erreur('providerRef')" />
              </label>

              <label
                class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
                for="preuve"
              >
                {{ $t('tontine.cotiser.capture_du_paiement_facultatif') }}
                <input
                  id="preuve"
                  type="file"
                  accept="image/*"
                  class="min-h-touch rounded-control border border-line-strong bg-surface p-2 text-sm"
                  data-testid="champ-preuve"
                  @change="choisirFichier"
                >
                <span
                  v-if="poidsPreuve !== null"
                  class="text-sm font-normal text-ink-subtle"
                  data-testid="poids-preuve"
                >
                  {{ $t('tontine.cotiser.image_compressee_a_p0', { p0: Math.round(poidsPreuve / 1024) }) }}
                </span>
              </label>

              <Button
                :label="envoi
                  ? $t('commun.envoi_en_cours')
                  : (verrou > 0 ? $t('tontine.cotiser.deja_declare_s', { s: verrou }) : $t('tontine.cotiser.declarer_mon_envoi'))"
                :disabled="envoi || verrou > 0 || (montantDeclare ?? 0) <= 0"
                class="bg-brand text-brand-ink hover:bg-brand-strong"
                data-testid="bouton-declarer"
                @click="declarer"
              />
            </div>
          </StepPanel>
        </StepPanels>
      </Stepper>
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
