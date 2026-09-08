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
definePageMeta({ layout: 'app', middleware: 'auth' })

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

const montantDeclare = ref(0)
const canalDeclare = ref<'wave' | 'orange' | 'mtn' | 'moov' | 'cash'>('wave')
const reference = ref('')
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
    ?? 'Impossible de joindre le serveur.'
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
  montantDeclare.value = info.value.expectedAmount
  reference.value = ''
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
      erreur.value = 'La capture ne peut pas être envoyée sans réseau. '
        + 'Ta déclaration partira quand même — tu pourras joindre l’image plus tard.'
    }

    // La clé d'idempotence est fabriquée **ici**, au moment de la saisie, et
    // voyage avec l'intention : que l'envoi parte maintenant ou dans une heure
    // au retour du réseau, le serveur ne créera qu'une seule déclaration.
    const { partie, reponse } = await envoyerOuEnfiler({
      url: `/api/v1/contributions/${cotisationChoisie.value.id}/declare`,
      method: 'POST',
      idempotencyKey: crypto.randomUUID(),
      libelle: `Déclaration de cotisation, tour ${tour.value?.index}`,
      body: {
        amount: montantDeclare.value,
        channel: canalDeclare.value,
        providerRef: reference.value || undefined,
        proofUrl,
      },
    })

    // Sur une tontine où le bureau n'a qu'un membre, le serveur confirme la
    // déclaration dans la foulée : il n'y a personne d'autre pour le faire.
    // Annoncer un trésorier qui va la confirmer serait annoncer une attente
    // qui n'arrivera jamais.
    const auto = (reponse as { autoConfirmee?: boolean } | undefined)?.autoConfirmee === true

    messageDeclaration.value = !partie
      ? 'Pas de réseau : ta déclaration est gardée et partira toute seule à la reconnexion. Tu n’as rien à refaire.'
      : auto
        ? 'Cotisation enregistrée et confirmée d’office : personne d’autre au bureau ne pouvait la vérifier. Le registre en garde la trace.'
        : 'Déclaration enregistrée. Le trésorier va la confirmer.'

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
      ? 'Cette cotisation a déjà été déclarée. Attends la confirmation du trésorier.'
      : (err.data?.error?.message ?? 'Impossible d’enregistrer la déclaration.')
  }
  finally {
    envoi.value = false
  }
}

onMounted(charger)
useEnTete(() => ({
  titre: 'Cotiser',
  retour: { to: '/app', label: 'Mes tontines' },
}))
useHead({ title: 'Cotiser — eTontine' })
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
      title="Aucun tour ouvert"
      description="Il n’y a rien à cotiser pour l’instant. Tu seras prévenu à l’ouverture du prochain tour."
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
            Récapitulatif
          </Step>
          <Step value="2">
            Où envoyer
          </Step>
          <Step value="3">
            Déclaration
          </Step>
        </StepList>

        <StepPanels>
          <!-- Étape 1 — ce que je dois -->
          <StepPanel value="1">
            <div class="flex flex-col gap-3">
              <p class="text-sm text-ink-muted">
                Tour {{ tour?.index }} · à verser avant le {{ tour?.dueDate }}
              </p>

              <p
                v-if="cotisations.length > 1"
                class="rounded-control bg-declared-surface p-3 text-sm text-declared-ink"
                data-testid="avertissement-parts-multiples"
              >
                Tu as {{ cotisations.length }} parts dans cette tontine : il y a
                donc {{ cotisations.length }} cotisations à verser ce tour-ci.
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
                    Le bureau a enregistré un versement en espèces de
                    <AmountDisplay
                      :amount="declaration.amount"
                      size="sm"
                    />
                    à ton nom. Est-ce exact ?
                  </span>
                </p>

                <template v-if="contestationOuverte === declaration.id">
                  <label
                    class="flex flex-col gap-1.5 text-sm font-medium text-declared-ink"
                    :for="`motif-contestation-${declaration.id}`"
                  >
                    Qu’est-ce qui ne va pas ?
                    <InputText
                      :id="`motif-contestation-${declaration.id}`"
                      v-model="motifContestation[declaration.id]"
                      placeholder="Je n’ai rien remis ce mois-ci"
                      :data-testid="`champ-motif-contestation-${declaration.id}`"
                    />
                  </label>
                  <Button
                    :label="decisionEnCours === declaration.id ? 'Envoi…' : 'Envoyer la contestation'"
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
                    :label="decisionEnCours === declaration.id ? 'Envoi…' : 'Oui, c’est exact'"
                    :disabled="decisionEnCours !== null"
                    class="bg-brand text-brand-ink hover:bg-brand-strong sm:flex-1"
                    :data-testid="`bouton-reconnaitre-${declaration.id}`"
                    @click="reconnaitre(declaration.id)"
                  />
                  <Button
                    label="Non, ce n’est pas exact"
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
                        Part en position {{ cotisation.rotationPosition }}
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
                        label="Envoyer"
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
                        Ce lien vaut preuve, et s’ouvre sans compte. Il expire au
                        bout d’un an.
                      </p>
                      <div class="flex flex-col gap-2 sm:flex-row">
                        <a
                          :href="recus[confirmeeDe(cotisation.id)!.id]"
                          target="_blank"
                          rel="noopener"
                          class="min-h-touch inline-flex flex-1 items-center justify-center rounded-control border border-line-strong bg-surface px-4 text-sm font-semibold text-ink"
                          :data-testid="`lien-recu-${cotisation.id}`"
                        >
                          Ouvrir le reçu
                        </a>
                        <Button
                          :label="copie ? 'Copié' : 'Copier le lien'"
                          class="border border-line-strong bg-surface text-ink hover:bg-surface-muted sm:flex-1"
                          :data-testid="`bouton-copier-recu-${cotisation.id}`"
                          @click="copier(recus[confirmeeDe(cotisation.id)!.id]!)"
                        />
                      </div>
                    </template>

                    <Button
                      v-else
                      :label="recuEnCours === confirmeeDe(cotisation.id)!.id ? 'Préparation…' : 'Obtenir mon reçu'"
                      :disabled="recuEnCours !== null"
                      class="border border-line-strong bg-surface text-ink hover:bg-surface-muted"
                      :data-testid="`bouton-recu-${cotisation.id}`"
                      @click="obtenirRecu(confirmeeDe(cotisation.id)!.id)"
                    />
                  </div>

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
                      <strong class="font-semibold">Ta déclaration a été rejetée.</strong>
                      {{ rejetDe(cotisation.id)?.rejectionReason }}
                    </span>
                  </p>
                </li>
              </ul>

              <p class="text-sm text-ink-muted">
                Total restant à verser :
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
                label="J’ai envoyé"
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
                As-tu bien envoyé le montant depuis ton téléphone ?
              </p>
              <p class="text-sm text-ink-muted">
                Déclare ton envoi : le trésorier le confirmera ensuite. Tant
                qu’il ne l’a pas fait, ta cotisation reste au statut
                « Déclaré ».
              </p>

              <label
                class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
                for="montant-declare"
              >
                Montant envoyé (FCFA)
                <InputText
                  id="montant-declare"
                  :value="montantDeclare"
                  inputmode="numeric"
                  data-testid="champ-montant-declare"
                  @input="montantDeclare = Number(($event.target as HTMLInputElement).value.replace(/\D/g, '')) || 0"
                />
              </label>

              <label
                class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
                for="canal-declare"
              >
                Par quel moyen ?
                <select
                  id="canal-declare"
                  v-model="canalDeclare"
                  class="min-h-touch rounded-control border border-line-strong bg-surface px-3 text-base text-ink"
                  data-testid="champ-canal-declare"
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
                for="reference-transaction"
              >
                Référence de la transaction (facultatif)
                <InputText
                  id="reference-transaction"
                  v-model="reference"
                  data-testid="champ-reference-transaction"
                />
              </label>

              <label
                class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
                for="preuve"
              >
                Capture du paiement (facultatif)
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
                  Image compressée à {{ Math.round(poidsPreuve / 1024) }} Ko avant envoi.
                </span>
              </label>

              <Button
                :label="envoi
                  ? 'Envoi…'
                  : (verrou > 0 ? `Déjà déclaré (${verrou} s)` : 'Déclarer mon envoi')"
                :disabled="envoi || verrou > 0 || montantDeclare <= 0"
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
