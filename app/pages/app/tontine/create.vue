<script setup lang="ts">
import type { TontineEmoji } from '#shared/constants/tontine'
import { TONTINE_EMOJIS } from '#shared/constants/tontine'
import { tontineDraftInput, tontineFinanceInput, tontineRulesInput } from '#shared/schemas'

/**
 * Wizard de création d'une tontine.
 *
 * Cinq écrans, numérotés de 1 à 5. Le cahier des charges (§ Module 3) en
 * prévoyait un sixième en tête, l'étape 0, pour choisir entre une tontine sur
 * invitation et une tontine « ouverte ». L'accès ouvert a été retiré — on ne
 * rejoint une tontine que par le lien de son organisateur —, et l'étape avec
 * lui : un écran sans autre choix qu'une seule case cochée d'avance n'est pas
 * une étape. La numérotation, elle, est restée : un brouillon gardé par le
 * navigateur rouvre ainsi sur le même écran qu'avant.
 *
 * **Le brouillon vit côté serveur**, enregistré à chaque étape. Le magasin
 * persisté ne retient que la position dans le wizard : de l'état d'interface,
 * jamais un réglage financier (règle 12).
 */
// Palier 1 pour ouvrir le wizard, palier 2 pour confirmer : voir la note de
// server/api/v1/tontines/index.post.ts sur la contradiction de spécification.
definePageMeta({ layout: 'app', middleware: ['auth', 'kyc-palier'], kycLevel: 1 })
const { t } = useI18n()

const brouillon = useBrouillonStore()
// Un brouillon gardé par le navigateur sur l'ancienne étape 0 — le choix
// d'accès, retiré depuis — rouvre sur la première étape qui existe.
if (brouillon.etape < 1) brouillon.etape = 1
const { format } = useMoney()
const { phrase, potParTour } = useSimulateur()

/** Les huit icônes proposées. Le serveur valide contre la même liste. */
const EMOJIS = TONTINE_EMOJIS
const seuilAlerte = useRuntimeConfig().public.potAlertThreshold as number

/** Les écrans, de l'étape 1 à l'étape 5 : `ETAPES[etape - 1]`. */
const ETAPES = [
  t('tontine.create.informations'), t('tontine.create.argent'), t('tontine.create.ordre_de_passage'), t('tontine.create.regles'), t('tontine.create.recapitulatif'),
] as const
const DERNIERE_ETAPE = ETAPES.length

const etat = ref<'chargement' | 'contenu' | 'erreur'>('chargement')
const enregistrement = ref(false)
const erreur = ref<string | null>(null)
const erreurCode = ref<string | null>(null)

/** L'adresse de la vérification d'identité, avec retour sur le wizard. */
const versIdentite = '/app/profil/identite?redirect=/app/tontine/create'

/**
 * Trois validations, une par étape qui saisit quelque chose, avec les schémas
 * que le serveur applique à la même requête. Le brouillon réactif reste la
 * source des champs — six écrans le lisent — et chaque validateur reçoit une
 * copie au moment de passer à l'étape suivante : l'erreur s'affiche alors sous
 * le champ, sans aller-retour réseau.
 */
const validationInfos = useFormulaire(tontineDraftInput.pick({ name: true, description: true, locality: true }))
// La date de départ est vérifiée à part (`dateValide`) : le schéma la compare
// en date locale, et l'écran veut le message avant la perte de focus.
const validationArgent = useFormulaire(tontineFinanceInput.pick({ shareAmount: true, frequency: true, collectionChannelIds: true }))
const validationRegles = useFormulaire(tontineRulesInput)

/** L'étape courante est-elle valide au regard de son schéma ? Pose les erreurs sinon. */
async function etapeValide(): Promise<boolean> {
  switch (brouillon.etape) {
    case 1:
      validationInfos.setValues({ name: form.name, description: form.description || undefined, locality: form.locality || undefined }, false)
      return (await validationInfos.valider()) !== null
    case 2:
      validationArgent.setValues({
        shareAmount: form.shareAmount, frequency: form.frequency,
        collectionChannelIds: form.collectionChannelIds,
      }, false)
      return (await validationArgent.valider()) !== null
    case 4:
      validationRegles.setValues({
        penaltyAmount: form.penaltyAmount, penaltyPeriod: form.penaltyPeriod,
        penaltyCap: form.penaltyCap ?? undefined, graceDays: form.graceDays,
      }, false)
      return (await validationRegles.valider()) !== null
    default:
      return true
  }
}

/** Les réglages en cours de saisie. Le serveur en garde la version qui fait foi. */
const form = reactive({
  name: '',
  emoji: null as TontineEmoji | null,
  description: '',
  locality: '',
  shareAmount: 0,
  frequency: 'monthly' as 'daily' | 'weekly' | 'biweekly' | 'monthly',
  startDate: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
  rotationMode: 'fixed' as 'fixed' | 'draw',
  // Le membre supporte les frais, à l'envoi comme au retrait, et il en connaît
  // l'ordre de grandeur. Le réglage reste dans le modèle de données, mais le
  // wizard n'offre plus de choix : proposer une option sans effet visible
  // serait un piège, et aucun écran n'affiche de frais.
  feesBearer: 'member' as const,
  penaltyAmount: 0,
  penaltyPeriod: 'once' as 'once' | 'per_day',
  penaltyCap: null as number | null,
  graceDays: 3,
  collectionChannelIds: [] as string[],
})

interface Canal {
  id: string
  provider: string
  msisdn: string
  holderName: string
}
const canaux = ref<Canal[]>([])

const simulation = computed(() =>
  phrase(form.shareAmount, brouillon.membresPrevus, form.frequency),
)

/**
 * La date du premier tour.
 *
 * Elle était fixée en silence à « aujourd'hui + 7 jours » et n'apparaissait
 * nulle part — alors que toutes les échéances du cycle en découlent. Un
 * président qui démarrait trois semaines après son brouillon voyait le tour 1
 * en retard dès la première heure. Le champ est borné à aujourd'hui : le
 * serveur refuse de toute façon de démarrer sur une date passée.
 */
const { formatDate } = useDate()
const aujourdhui = new Date().toISOString().slice(0, 10)
const dateValide = computed(() => /^\d{4}-\d{2}-\d{2}$/.test(form.startDate) && form.startDate >= aujourdhui)
const potEstime = computed(() => potParTour(form.shareAmount, brouillon.membresPrevus))
const alertePlafond = computed(() => potEstime.value > seuilAlerte)

/** Tous les canaux du compte : il n'y a plus de vérification par SMS qui en écarterait. */
const canauxVerifies = computed(() => canaux.value)

type ErreurApi = { data?: { error?: { code?: string, message?: string } } }

function message(e: unknown): string {
  return (e as ErreurApi)?.data?.error?.message ?? t('commun.serveur_injoignable')
}

/**
 * Le code d'erreur, retenu à côté du message.
 *
 * Un refus pour palier manquant est le seul que l'organisateur ne peut pas
 * lever depuis cet écran : lui répéter qu'il faut une pièce vérifiée sans lui
 * donner le chemin est un cul-de-sac, d'autant qu'il est arrivé jusqu'au
 * récapitulatif. Le bandeau porte donc la sortie.
 */
function code(e: unknown): string | null {
  return (e as ErreurApi)?.data?.error?.code ?? null
}

async function charger() {
  etat.value = 'chargement'
  try {
    canaux.value = await $fetch<Canal[]>('/api/v1/me/channels')

    // Un identifiant dans l'adresse l'emporte sur ce que le navigateur a
    // gardé. C'est ce qui manquait : depuis les réglages d'une tontine, le
    // wizard reprenait le brouillon du magasin — vidé après chaque
    // publication — et ouvrait donc une **seconde** tontine au lieu de
    // modifier celle qu'on venait de quitter.
    const demande = useRoute().query.id
    if (typeof demande === 'string' && demande !== brouillon.tontineId) {
      brouillon.reprendre(demande, 1)
    }

    // Reprise d'un brouillon laissé en plan : on recharge ses valeurs réelles
    // depuis le serveur, jamais depuis le stockage du navigateur.
    if (brouillon.tontineId) {
      try {
        const t = await $fetch<Record<string, unknown>>(`/api/v1/tontines/${brouillon.tontineId}`)
        // Confirmée entre-temps — depuis sa page ou depuis l'accueil : ce
        // n'est plus un brouillon, le wizard repart d'une tontine neuve au
        // lieu de proposer de valider une seconde fois ce qui l'est déjà.
        if (t.status !== 'draft') throw new Error('plus un brouillon')
        Object.assign(form, {
          name: t.name, description: t.description ?? '',
          emoji: t.emoji ?? null,
          locality: t.locality ?? '', shareAmount: t.shareAmount, frequency: t.frequency,
          startDate: t.startDate, rotationMode: t.rotationMode, feesBearer: t.feesBearer,
          penaltyAmount: t.penaltyAmount, penaltyPeriod: t.penaltyPeriod,
          penaltyCap: t.penaltyCap, graceDays: t.graceDays,
          collectionChannelIds: (t.channels as Array<{ id: string }>).map(c => c.id),
        })
      }
      catch {
        // Brouillon disparu ou déjà confirmé : on repart proprement.
        brouillon.terminer()
      }
    }
    etat.value = 'contenu'
  }
  catch (e) {
    erreur.value = message(e)
    etat.value = 'erreur'
  }
}

onMounted(charger)

/** Enregistre l'étape courante, puis avance. */
async function suivant() {
  erreur.value = null
  erreurCode.value = null
  if (!(await etapeValide())) return
  enregistrement.value = true
  try {
    if (!brouillon.tontineId) {
      const { id } = await $fetch<{ id: string }>('/api/v1/tontines', {
        method: 'POST',
        body: {
          name: form.name,
          description: form.description || undefined,
          emoji: form.emoji ?? undefined,
          locality: form.locality || undefined,
        },
      })
      brouillon.demarrer(id)
      brouillon.etape = 2
      return
    }

    await $fetch(`/api/v1/tontines/${brouillon.tontineId}`, {
      method: 'PATCH',
      body: corpsDeLEtape(),
    })
    brouillon.etape = Math.min(brouillon.etape + 1, DERNIERE_ETAPE)
  }
  catch (e) {
    erreur.value = message(e)
    erreurCode.value = code(e)
  }
  finally {
    enregistrement.value = false
  }
}

function corpsDeLEtape(): Record<string, unknown> {
  switch (brouillon.etape) {
    case 1:
      return {
        name: form.name,
        description: form.description || null,
        emoji: form.emoji,
        locality: form.locality || null,
      }
    case 2:
      return {
        shareAmount: form.shareAmount,
        frequency: form.frequency,
        startDate: form.startDate,
        feesBearer: form.feesBearer,
        collectionChannelIds: form.collectionChannelIds,
      }
    case 3:
      return { rotationMode: form.rotationMode }
    case 4:
      return {
        penaltyAmount: form.penaltyAmount,
        penaltyPeriod: form.penaltyPeriod,
        penaltyCap: form.penaltyCap,
        graceDays: form.graceDays,
      }
    default:
      return {}
  }
}

/**
 * « Confirmer » : la tontine est validée d'office si l'identité de
 * l'organisateur est vérifiée ; sinon, direction la vérification, qui ramène
 * sur la tontine. Le brouillon est déjà enregistré côté serveur à chaque
 * étape : il ne se perd ni dans un cas ni dans l'autre.
 */
const { confirmer, erreur: erreurConfirmation } = useConfirmationTontine()

async function confirmerTontine() {
  if (!brouillon.tontineId) return
  erreur.value = null
  erreurCode.value = null
  enregistrement.value = true
  try {
    const issue = await confirmer(brouillon.tontineId)
    if (issue === 'refusee') {
      erreur.value = erreurConfirmation.value?.message ?? null
      return
    }
    // Validée, ou partie attendre la vérification d'identité — son bouton
    // « Confirmer » l'attend alors sur la page de la tontine. Le wizard n'a
    // plus à la rouvrir : « Créer une tontine » en commencera une neuve.
    brouillon.terminer()
  }
  finally {
    enregistrement.value = false
  }
}

const peutAvancer = computed(() => {
  switch (brouillon.etape) {
    case 1: return form.name.trim().length >= 3
    case 2: return form.shareAmount > 0 && form.collectionChannelIds.length > 0 && dateValide.value
    default: return true
  }
})

// Pas de sous-titre d'étape ici : la barre segmentée et la ligne qui la suit
// le disent déjà, et l'écrire trois fois sur le même écran n'aide personne.
useEnTete(() => ({
  titre: t('tontine.create.nouvelle_tontine'),
  retour: { to: '/app', label: t('commun.mes_tontines') },
}))
useHead({ title: t('tontine.create.creer_une_tontine_etontine') })
</script>

<template>
  <div class="flex flex-col gap-5">
    <!-- Barre d'étapes segmentée, reprise du wizard du template : un segment
         par étape, celui en cours et les précédents remplis. À 360 px, six
         segments et six libellés tiennent sur deux lignes là où un `Stepper`
         complet déborde. Le libellé long reste sous la barre pour les
         lecteurs d'écran et pour les tests. -->
    <header class="flex flex-col gap-2">
      <ol class="flex items-center gap-1.5">
        <li
          v-for="(nom, i) in ETAPES"
          :key="nom"
          class="min-w-0 flex-1"
        >
          <span
            class="block h-1.5 rounded-full transition-colors"
            :class="i < brouillon.etape ? 'bg-brand' : 'bg-surface-sunken'"
          />
          <span
            class="mt-1 block truncate text-[10px] font-semibold"
            :class="i < brouillon.etape ? 'text-brand' : 'text-ink-subtle'"
          >{{ nom }}</span>
        </li>
      </ol>
      <p
        class="text-sm text-ink-muted"
        data-testid="etape-courante"
      >
        {{ $t('tontine.create.etape_p0_sur_p1', { p0: brouillon.etape, p1: DERNIERE_ETAPE, p2: ETAPES[brouillon.etape - 1] }) }}
      </p>
    </header>

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

    <template v-else>
      <!-- Étape 1 — Informations -->
      <section
        v-if="brouillon.etape === 1"
        class="flex flex-col gap-3"
        data-testid="etape-informations"
      >
        <label
          class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
          for="nom"
        >
          {{ $t('tontine.create.nom_de_la_tontine') }}
          <InputText
            id="nom"
            v-model="form.name"
            :placeholder="$t('tontine.create.tontine_du_marche_de')"
            :aria-invalid="Boolean(validationInfos.erreur('name'))"
            data-testid="champ-nom-tontine"
          />
          <ErreurChamp :message="validationInfos.erreur('name')" />
        </label>
        <!-- Sélecteur d'icône, repris du wizard du template. Sur une liste de
             tontines, l'image se repère avant le nom — et c'est encore plus
             vrai pour quelqu'un qui lit lentement (§7 du cahier). Il reste
             facultatif : aucune tontine n'est bloquée faute d'image. -->
        <fieldset class="flex flex-col gap-2">
          <legend class="pb-1 text-sm font-medium text-ink-muted">
            {{ $t('tontine.create.image_facultatif') }}
          </legend>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="e in EMOJIS"
              :key="e"
              type="button"
              class="card-surface flex size-touch items-center justify-center text-xl transition-shadow"
              :class="form.emoji === e ? 'ring-2 ring-brand' : 'hover:shadow-float'"
              :aria-pressed="form.emoji === e"
              :data-testid="`emoji-${e}`"
              @click="form.emoji = form.emoji === e ? null : e"
            >
              {{ e }}
            </button>
          </div>
        </fieldset>

        <label
          class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
          for="lieu"
        >
          {{ $t('tontine.create.quartier_ou_lieu') }}
          <InputText
            id="lieu"
            v-model="form.locality"
            :placeholder="$t('tontine.create.cocody')"
          />
        </label>
        <label
          class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
          for="description"
        >
          {{ $t('tontine.create.description') }}
          <InputText
            id="description"
            v-model="form.description"
            :placeholder="$t('tontine.create.tontine_mensuelle_entre_voisines')"
          />
        </label>
      </section>

      <!-- Étape 2 — Argent -->
      <section
        v-else-if="brouillon.etape === 2"
        class="flex flex-col gap-4"
        data-testid="etape-argent"
      >
        <label
          class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
          for="montant"
        >
          {{ $t('tontine.create.montant_d_une_part') }}
          <InputText
            id="montant"
            :value="form.shareAmount || ''"
            inputmode="numeric"
            placeholder="10000"
            data-testid="champ-montant"
            @input="form.shareAmount = Number(($event.target as HTMLInputElement).value.replace(/\D/g, '')) || 0"
          />
          <ErreurChamp :message="validationArgent.erreur('shareAmount')" />
        </label>

        <label
          class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
          for="frequence"
        >
          {{ $t('tontine.create.frequence') }}
          <select
            id="frequence"
            v-model="form.frequency"
            class="min-h-touch rounded-control border border-line-strong bg-surface px-3 text-base text-ink"
            data-testid="champ-frequence"
          >
            <option value="daily">{{ $t('tontine.create.journaliere') }}</option>
            <option value="weekly">{{ $t('tontine.create.hebdomadaire') }}</option>
            <option value="biweekly">{{ $t('tontine.create.tous_les_quinze_jours') }}</option>
            <option value="monthly">{{ $t('tontine.create.mensuelle') }}</option>
          </select>
        </label>

        <label
          class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
          for="date-demarrage"
        >
          {{ $t('tontine.create.date_du_premier_tour') }}
          <input
            id="date-demarrage"
            v-model="form.startDate"
            type="date"
            :min="aujourdhui"
            class="min-h-touch rounded-control border border-line-strong bg-surface px-3 text-base text-ink"
            data-testid="champ-date-demarrage"
          >
          <span class="text-sm font-normal text-ink-subtle">
            {{ $t('tontine.create.toutes_les_echeances_en') }}
          </span>
          <span
            v-if="form.startDate && !dateValide"
            class="text-sm font-normal text-disputed-ink"
            role="alert"
            data-testid="erreur-date-demarrage"
          >
            {{ $t('tontine.create.la_date_ne_peut') }}
          </span>
        </label>

        <label
          class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
          for="membres"
        >
          {{ $t('tontine.create.nombre_de_parts_prevu') }}
          <InputText
            id="membres"
            :value="brouillon.membresPrevus"
            inputmode="numeric"
            data-testid="champ-membres"
            @input="brouillon.membresPrevus = Number(($event.target as HTMLInputElement).value.replace(/\D/g, '')) || 0"
          />
          <span class="text-sm font-normal text-ink-subtle">
            {{ $t('tontine.create.une_estimation_pour_la') }}
          </span>
        </label>

        <!-- Simulateur en direct : l'organisateur voit la conséquence de ses
           réglages avant de valider, pas au troisième tour. -->
        <p
          v-if="simulation"
          class="rounded-card border border-line bg-surface-muted p-3 text-base text-ink"
          data-testid="simulateur"
        >
          {{ simulation }}
        </p>

        <p
          v-if="alertePlafond"
          class="flex items-start gap-2 rounded-card bg-late-surface p-3 text-sm text-late-ink"
          role="status"
          data-testid="alerte-plafond"
        >
          <Icon
            name="lucide:triangle-alert"
            size="1rem"
            class="mt-0.5 shrink-0"
            aria-hidden="true"
          />
          <span>
            {{ $t('tontine.create.ton_pot_atteindra_environ', { p0: format(potEstime) }) }}
          </span>
        </p>

        <fieldset class="flex flex-col gap-2">
          <legend class="pb-1 text-sm font-medium text-ink-muted">
            {{ $t('tontine.create.numero_de_collecte') }}
          </legend>

          <!-- L'état vide portait un texte impératif sans aucune action :
               « Ajoute le numéro… » alors qu'aucun écran ne le permettait. Le
               parcours s'arrêtait ici pour tout nouvel organisateur. Le
               `redirect` ramène à l'étape en cours — le brouillon vit côté
               serveur, mais revenir au tableau de bord ferait croire l'inverse. -->
          <EmptyState
            v-if="canauxVerifies.length === 0"
            :title="$t('tontine.create.aucun_numero_verifie')"
            :description="$t('tontine.create.il_te_faut_un')"
            icon="lucide:smartphone"
          >
            <template #action>
              <NuxtLink
                :to="`/app/profil/canaux?redirect=${encodeURIComponent($route.fullPath)}`"
                class="min-h-touch inline-flex items-center justify-center gap-2 rounded-control bg-brand px-5 font-semibold text-brand-ink"
                data-testid="lien-ajouter-canal"
              >
                <Icon
                  name="lucide:plus"
                  size="1rem"
                  aria-hidden="true"
                />
                {{ $t('tontine.create.ajouter_un_numero') }}
              </NuxtLink>
            </template>
          </EmptyState>

          <label
            v-for="canal in canauxVerifies"
            :key="canal.id"
            class="flex min-h-touch items-center gap-3 card-surface p-3"
          >
            <input
              v-model="form.collectionChannelIds"
              type="checkbox"
              :value="canal.id"
              class="size-5 shrink-0 accent-brand"
              :data-testid="`canal-${canal.id}`"
            >
            <span class="text-sm">
              <span class="font-medium text-ink">{{ canal.holderName }}</span>
              <span class="block text-ink-muted">{{ canal.provider }} · {{ canal.msisdn }}</span>
            </span>
          </label>

          <NuxtLink
            v-if="canauxVerifies.length > 0"
            :to="`/app/profil/canaux?redirect=${encodeURIComponent($route.fullPath)}`"
            class="min-h-touch inline-flex items-center gap-1.5 text-sm font-semibold text-brand"
            data-testid="lien-ajouter-canal"
          >
            <Icon
              name="lucide:plus"
              size="1rem"
              aria-hidden="true"
            />
            {{ $t('tontine.create.ajouter_un_autre_numero') }}
          </NuxtLink>
        </fieldset>
      </section>

      <!-- Étape 3 — Ordre de passage -->
      <section
        v-else-if="brouillon.etape === 3"
        class="flex flex-col gap-3"
        data-testid="etape-ordre"
      >
        <label class="flex min-h-touch items-start gap-3 card-surface p-4">
          <input
            v-model="form.rotationMode"
            type="radio"
            value="fixed"
            class="mt-1 size-5 shrink-0 accent-brand"
            data-testid="ordre-fixe"
          >
          <span>
            <span class="font-medium text-ink">{{ $t('tontine.create.ordre_fixe') }}</span>
            <span class="block text-sm text-ink-muted">
              {{ $t('tontine.create.tu_decides_qui_prend') }}
            </span>
          </span>
        </label>
        <label class="flex min-h-touch items-start gap-3 card-surface p-4">
          <input
            v-model="form.rotationMode"
            type="radio"
            value="draw"
            class="mt-1 size-5 shrink-0 accent-brand"
            data-testid="ordre-tirage"
          >
          <span>
            <span class="font-medium text-ink">{{ $t('tontine.create.tirage_au_sort') }}</span>
            <span class="block text-sm text-ink-muted">
              {{ $t('tontine.create.le_tirage_est_fait') }}
            </span>
          </span>
        </label>
      </section>

      <!-- Étape 4 — Règles -->
      <section
        v-else-if="brouillon.etape === 4"
        class="flex flex-col gap-3"
        data-testid="etape-regles"
      >
        <label
          class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
          for="amende"
        >
          {{ $t('tontine.create.amende_de_retard_fcfa') }}
          <InputText
            id="amende"
            :value="form.penaltyAmount"
            inputmode="numeric"
            data-testid="champ-amende"
            @input="form.penaltyAmount = Number(($event.target as HTMLInputElement).value.replace(/\D/g, '')) || 0"
          />
        </label>

        <fieldset
          v-if="form.penaltyAmount > 0"
          class="flex flex-col gap-2"
        >
          <legend class="pb-1 text-sm font-medium text-ink-muted">
            {{ $t('tontine.create.comment_s_applique_t') }}
          </legend>
          <label class="flex min-h-touch items-center gap-3 text-sm">
            <input
              v-model="form.penaltyPeriod"
              type="radio"
              value="once"
              class="size-5 accent-brand"
            >
            {{ $t('tontine.create.une_seule_fois_passe') }}
          </label>
          <label class="flex min-h-touch items-center gap-3 text-sm">
            <input
              v-model="form.penaltyPeriod"
              type="radio"
              value="per_day"
              class="size-5 accent-brand"
            >
            {{ $t('tontine.create.par_jour_de_retard') }}
          </label>
        </fieldset>

        <label
          v-if="form.penaltyPeriod === 'per_day' && form.penaltyAmount > 0"
          class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
          for="plafond-amende"
        >
          {{ $t('tontine.create.plafond_de_l_amende') }}
          <InputText
            id="plafond-amende"
            :value="form.penaltyCap ?? ''"
            inputmode="numeric"
            data-testid="champ-plafond-amende"
            @input="form.penaltyCap = Number(($event.target as HTMLInputElement).value.replace(/\D/g, '')) || null"
          />
          <ErreurChamp :message="validationRegles.erreur('penaltyCap')" />
          <span class="text-sm font-normal text-ink-subtle">
            {{ $t('tontine.create.une_amende_journaliere_sans') }}
          </span>
        </label>

        <label
          class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
          for="grace"
        >
          {{ $t('tontine.create.delai_de_grace_jours') }}
          <InputText
            id="grace"
            :value="form.graceDays"
            inputmode="numeric"
            data-testid="champ-grace"
            @input="form.graceDays = Number(($event.target as HTMLInputElement).value.replace(/\D/g, '')) || 0"
          />
          <ErreurChamp :message="validationRegles.erreur('graceDays')" />
        </label>
      </section>

      <!-- Étape 5 — Récapitulatif -->
      <section
        v-else
        class="flex flex-col gap-3"
        data-testid="etape-recapitulatif"
      >
        <div class="flex flex-col gap-2 card-surface p-4">
          <p class="text-lg font-semibold text-ink">
            {{ form.name }}
          </p>
          <p
            v-if="form.locality"
            class="text-sm text-ink-muted"
          >
            {{ form.locality }}
          </p>
          <p class="text-base text-ink">
            <AmountDisplay
              :amount="form.shareAmount"
              size="lg"
            />
            {{ $t('tontine.create.par_part') }}
          </p>
          <p
            v-if="simulation"
            class="text-sm text-ink-muted"
          >
            {{ simulation }}
          </p>
          <p class="text-sm text-ink-muted">
            {{ $t('tontine.create.ordre_de_passage_p0', { p0: form.rotationMode === 'draw' ? $t('tontine.create.tirage_au_sort_2') : 'fixe' }) }}
          </p>
          <p
            class="text-sm text-ink-muted"
            data-testid="recap-date-demarrage"
          >
            {{ $t('tontine.create.premier_tour_le_p0', { p0: formatDate(form.startDate) }) }}
          </p>
        </div>

        <!-- Il n'y a plus d'accès à choisir : le récapitulatif dit celui
             qu'elle aura, le seul. -->
        <p
          class="flex items-start gap-2 text-sm text-ink-muted"
          data-testid="recap-acces"
        >
          <Icon
            name="lucide:lock"
            size="1rem"
            class="mt-0.5 shrink-0"
            aria-hidden="true"
          />
          {{ $t('tontine.create.sur_invitation_personne_ne') }}
        </p>

        <p class="text-sm text-ink-muted">
          {{ $t('tontine.create.apres_publication_tu_pourras') }}
        </p>
      </section>

      <!-- Couleur + icône + mot (règle 10), et une sortie quand il en existe une. -->
      <div
        v-if="erreur"
        role="alert"
        class="flex flex-col gap-3 rounded-control bg-disputed-surface p-3 text-sm text-disputed-ink"
        data-testid="erreur-wizard"
      >
        <p class="flex items-start gap-1.5">
          <Icon
            name="lucide:triangle-alert"
            size="0.875rem"
            class="mt-0.5 shrink-0"
            aria-hidden="true"
          />
          {{ erreur }}
        </p>
        <NuxtLink
          v-if="erreurCode === 'KYC_REQUIRED'"
          :to="versIdentite"
          class="inline-flex min-h-touch items-center justify-center gap-1.5 rounded-control
                 bg-brand px-4 font-medium text-brand-ink hover:bg-brand-strong"
          data-testid="lien-verifier-identite"
        >
          <Icon
            name="lucide:id-card"
            size="1rem"
            aria-hidden="true"
          />
          {{ $t('tontine.create.verifier_mon_identite') }}
        </NuxtLink>
      </div>

      <!-- Règle 13 : les actions primaires en bas d'écran. -->
      <div class="mt-auto flex flex-col gap-2 pt-2 sm:flex-row-reverse">
        <Button
          v-if="brouillon.etape < DERNIERE_ETAPE"
          :label="enregistrement ? $t('tontine.create.enregistrement') : $t('tontine.create.continuer')"
          :disabled="!peutAvancer || enregistrement"
          class="bg-brand text-brand-ink hover:bg-brand-strong sm:flex-1"
          data-testid="bouton-continuer"
          @click="suivant"
        />
        <Button
          v-else
          :label="enregistrement ? $t('commun.confirmation_en_cours') : $t('commun.confirmer')"
          :disabled="enregistrement"
          class="bg-brand text-brand-ink hover:bg-brand-strong sm:flex-1"
          data-testid="bouton-confirmer"
          @click="confirmerTontine"
        />

        <Button
          v-if="brouillon.etape > 1"
          :label="$t('tontine.create.retour')"
          class="border border-line-strong bg-surface text-ink hover:bg-surface-muted sm:flex-1"
          data-testid="bouton-retour"
          @click="brouillon.etape--"
        />
      </div>
    </template>
  </div>
</template>

<!--
  États d'écran (règle 14) :
  · chargement — squelette pendant la lecture des canaux et du brouillon
  · vide       — EmptyState quand aucun numéro de collecte n'est vérifié
  · erreur     — ErrorState avec reprise, et messages en ligne par étape
  · hors-ligne — bandeau porté par `layouts/app.vue`
  · contenu    — le wizard
-->
