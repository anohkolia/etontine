<script setup lang="ts">
/**
 * Wizard de création d'une tontine.
 *
 * Six écrans, conformément à docs/cahier-des-charges.md § Module 3 : le choix
 * d'accès (étape 0) précède les cinq étapes de configuration. Le backlog parle
 * de « 5 étapes » — l'écart est signalé, la spécification détaillée fait foi.
 *
 * **Le brouillon vit côté serveur**, enregistré à chaque étape. Le magasin
 * persisté ne retient que la position dans le wizard : de l'état d'interface,
 * jamais un réglage financier (règle 12).
 */
// Palier 1 pour ouvrir le wizard, palier 2 pour publier : voir la note de
// server/api/v1/tontines/index.post.ts sur la contradiction de spécification.
definePageMeta({ layout: 'app', middleware: ['auth', 'kyc-palier'], kycLevel: 1 })

const brouillon = useBrouillonStore()
const session = useSessionStore()
const { format } = useMoney()
const { phrase, potParTour } = useSimulateur()
const seuilAlerte = useRuntimeConfig().public.potAlertThreshold as number

const ETAPES = [
  'Accès', 'Informations', 'Argent', 'Ordre de passage', 'Règles', 'Récapitulatif',
] as const

const etat = ref<'chargement' | 'contenu' | 'erreur'>('chargement')
const enregistrement = ref(false)
const erreur = ref<string | null>(null)

/** Les réglages en cours de saisie. Le serveur en garde la version qui fait foi. */
const form = reactive({
  access: 'private' as 'private' | 'open',
  name: '',
  description: '',
  locality: '',
  shareAmount: 0,
  frequency: 'monthly' as 'daily' | 'weekly' | 'biweekly' | 'monthly',
  startDate: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
  rotationMode: 'fixed' as 'fixed' | 'draw',
  feesBearer: 'member' as 'member' | 'tontine',
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
  verifiedAt: string | null
}
const canaux = ref<Canal[]>([])

/** Le palier 2 est exigé pour publier une tontine ouverte. */
const peutOuvrir = computed(() => (session.user?.kycLevel ?? 0) >= 2)

const simulation = computed(() =>
  phrase(form.shareAmount, brouillon.membresPrevus, form.frequency),
)
const potEstime = computed(() => potParTour(form.shareAmount, brouillon.membresPrevus))
const alertePlafond = computed(() => potEstime.value > seuilAlerte)

const canauxVerifies = computed(() => canaux.value.filter(c => c.verifiedAt !== null))

function message(e: unknown): string {
  return (e as { data?: { error?: { message?: string } } })?.data?.error?.message
    ?? 'Impossible de joindre le serveur.'
}

async function charger() {
  etat.value = 'chargement'
  try {
    canaux.value = await $fetch<Canal[]>('/api/v1/me/channels')

    // Reprise d'un brouillon laissé en plan : on recharge ses valeurs réelles
    // depuis le serveur, jamais depuis le stockage du navigateur.
    if (brouillon.tontineId) {
      try {
        const t = await $fetch<Record<string, unknown>>(`/api/v1/tontines/${brouillon.tontineId}`)
        Object.assign(form, {
          access: t.access, name: t.name, description: t.description ?? '',
          locality: t.locality ?? '', shareAmount: t.shareAmount, frequency: t.frequency,
          startDate: t.startDate, rotationMode: t.rotationMode, feesBearer: t.feesBearer,
          penaltyAmount: t.penaltyAmount, penaltyPeriod: t.penaltyPeriod,
          penaltyCap: t.penaltyCap, graceDays: t.graceDays,
          collectionChannelIds: (t.channels as Array<{ id: string }>).map(c => c.id),
        })
      }
      catch {
        // Brouillon disparu côté serveur : on repart proprement.
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
  enregistrement.value = true
  try {
    if (brouillon.etape === 0) {
      brouillon.etape = 1
      return
    }

    if (!brouillon.tontineId) {
      const { id } = await $fetch<{ id: string }>('/api/v1/tontines', {
        method: 'POST',
        body: {
          name: form.name,
          description: form.description || undefined,
          locality: form.locality || undefined,
          access: form.access,
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
    brouillon.etape = Math.min(brouillon.etape + 1, ETAPES.length - 1)
  }
  catch (e) {
    erreur.value = message(e)
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
        locality: form.locality || null,
        access: form.access,
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

async function publier() {
  erreur.value = null
  enregistrement.value = true
  try {
    await $fetch(`/api/v1/tontines/${brouillon.tontineId}/publish`, { method: 'POST' })
    const id = brouillon.tontineId
    brouillon.terminer()
    await navigateTo(`/app/tontine/${id}/membres`)
  }
  catch (e) {
    erreur.value = message(e)
  }
  finally {
    enregistrement.value = false
  }
}

const peutAvancer = computed(() => {
  switch (brouillon.etape) {
    case 1: return form.name.trim().length >= 3
    case 2: return form.shareAmount > 0 && form.collectionChannelIds.length > 0
    default: return true
  }
})

useHead({ title: 'Créer une tontine — Tontine CI' })
</script>

<template>
  <div class="flex flex-col gap-5">
    <header class="flex flex-col gap-2">
      <h1 class="text-xl font-bold text-ink">
        Créer une tontine
      </h1>
      <p
        class="text-sm text-ink-muted"
        data-testid="etape-courante"
      >
        Étape {{ brouillon.etape + 1 }} sur {{ ETAPES.length }} — {{ ETAPES[brouillon.etape] }}
      </p>
      <ProgressBar
        :value="Math.round(((brouillon.etape + 1) / ETAPES.length) * 100)"
        :aria-label="`Étape ${brouillon.etape + 1} sur ${ETAPES.length}`"
      />
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
      <!-- Étape 0 — Type d'accès -->
      <section
        v-if="brouillon.etape === 0"
        class="flex flex-col gap-3"
        data-testid="etape-acces"
      >
        <label class="flex min-h-touch items-start gap-3 rounded-card border border-line bg-surface p-4">
          <input
            v-model="form.access"
            type="radio"
            value="private"
            class="mt-1 size-5 shrink-0 accent-brand"
            data-testid="acces-prive"
          >
          <span>
            <span class="font-medium text-ink">Tontine privée</span>
            <span class="block text-sm text-ink-muted">
              Sur invitation. Personne ne la trouve sans ton lien.
            </span>
          </span>
        </label>

        <!-- Grisée si le palier manque, jamais masquée : l'organisateur doit
           savoir que l'option existe et ce qu'il faut pour y accéder. -->
        <label
          class="flex min-h-touch items-start gap-3 rounded-card border border-line bg-surface p-4"
          :class="peutOuvrir ? '' : 'opacity-60'"
        >
          <input
            v-model="form.access"
            type="radio"
            value="open"
            :disabled="!peutOuvrir"
            class="mt-1 size-5 shrink-0 accent-brand"
            data-testid="acces-ouvert"
          >
          <span>
            <span class="font-medium text-ink">Tontine ouverte</span>
            <span class="block text-sm text-ink-muted">
              Visible publiquement, n’importe qui peut demander à rejoindre.
            </span>
            <span
              v-if="!peutOuvrir"
              class="mt-1 flex items-start gap-1.5 text-sm text-late-ink"
              data-testid="explication-kyc"
            >
              <Icon
                name="lucide:lock"
                size="0.875rem"
                class="mt-0.5 shrink-0"
                aria-hidden="true"
              />
              Demande une pièce d’identité vérifiée. Tu peux la fournir dans ton profil.
            </span>
          </span>
        </label>
      </section>

      <!-- Étape 1 — Informations -->
      <section
        v-else-if="brouillon.etape === 1"
        class="flex flex-col gap-3"
        data-testid="etape-informations"
      >
        <label
          class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
          for="nom"
        >
          Nom de la tontine
          <InputText
            id="nom"
            v-model="form.name"
            placeholder="Tontine du marché de Cocody"
            data-testid="champ-nom-tontine"
          />
        </label>
        <label
          class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
          for="lieu"
        >
          Quartier ou lieu
          <InputText
            id="lieu"
            v-model="form.locality"
            placeholder="Cocody"
          />
        </label>
        <label
          class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
          for="description"
        >
          Description
          <InputText
            id="description"
            v-model="form.description"
            placeholder="Tontine mensuelle entre voisines"
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
          Montant d’une part (FCFA)
          <InputText
            id="montant"
            :value="form.shareAmount || ''"
            inputmode="numeric"
            placeholder="10000"
            data-testid="champ-montant"
            @input="form.shareAmount = Number(($event.target as HTMLInputElement).value.replace(/\D/g, '')) || 0"
          />
        </label>

        <label
          class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
          for="frequence"
        >
          Fréquence
          <select
            id="frequence"
            v-model="form.frequency"
            class="min-h-touch rounded-control border border-line-strong bg-surface px-3 text-base text-ink"
            data-testid="champ-frequence"
          >
            <option value="daily">Journalière</option>
            <option value="weekly">Hebdomadaire</option>
            <option value="biweekly">Tous les quinze jours</option>
            <option value="monthly">Mensuelle</option>
          </select>
        </label>

        <label
          class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
          for="membres"
        >
          Nombre de parts prévu
          <InputText
            id="membres"
            :value="brouillon.membresPrevus"
            inputmode="numeric"
            data-testid="champ-membres"
            @input="brouillon.membresPrevus = Number(($event.target as HTMLInputElement).value.replace(/\D/g, '')) || 0"
          />
          <span class="text-sm font-normal text-ink-subtle">
            Une estimation, pour la simulation. Le pot réel se calculera sur les
            parts réellement attribuées.
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
            Ton pot atteindra environ {{ format(potEstime) }}. Vérifie le plafond
            de ton compte de monnaie électronique avant de démarrer.
          </span>
        </p>

        <fieldset class="flex flex-col gap-2">
          <legend class="pb-1 text-sm font-medium text-ink-muted">
            Numéro de collecte
          </legend>

          <EmptyState
            v-if="canauxVerifies.length === 0"
            title="Aucun numéro vérifié"
            description="Ajoute le numéro sur lequel tu recevras les cotisations, puis vérifie-le par SMS."
            icon="lucide:smartphone"
          />

          <label
            v-for="canal in canauxVerifies"
            :key="canal.id"
            class="flex min-h-touch items-center gap-3 rounded-card border border-line bg-surface p-3"
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
        </fieldset>

        <fieldset class="flex flex-col gap-2">
          <legend class="pb-1 text-sm font-medium text-ink-muted">
            Qui paie les frais d’envoi ?
          </legend>
          <label class="flex min-h-touch items-center gap-3 text-sm">
            <input
              v-model="form.feesBearer"
              type="radio"
              value="member"
              class="size-5 accent-brand"
            >
            Chaque membre, sur son envoi
          </label>
          <label class="flex min-h-touch items-center gap-3 text-sm">
            <input
              v-model="form.feesBearer"
              type="radio"
              value="tontine"
              class="size-5 accent-brand"
            >
            La tontine, sur le pot
          </label>
        </fieldset>
      </section>

      <!-- Étape 3 — Ordre de passage -->
      <section
        v-else-if="brouillon.etape === 3"
        class="flex flex-col gap-3"
        data-testid="etape-ordre"
      >
        <label class="flex min-h-touch items-start gap-3 rounded-card border border-line bg-surface p-4">
          <input
            v-model="form.rotationMode"
            type="radio"
            value="fixed"
            class="mt-1 size-5 shrink-0 accent-brand"
            data-testid="ordre-fixe"
          >
          <span>
            <span class="font-medium text-ink">Ordre fixe</span>
            <span class="block text-sm text-ink-muted">
              Tu décides qui prend la main, et dans quel ordre.
            </span>
          </span>
        </label>
        <label class="flex min-h-touch items-start gap-3 rounded-card border border-line bg-surface p-4">
          <input
            v-model="form.rotationMode"
            type="radio"
            value="draw"
            class="mt-1 size-5 shrink-0 accent-brand"
            data-testid="ordre-tirage"
          >
          <span>
            <span class="font-medium text-ink">Tirage au sort</span>
            <span class="block text-sm text-ink-muted">
              Le tirage est fait par le serveur et inscrit au registre, horodaté.
              Personne ne peut soupçonner un arrangement.
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
          Amende de retard (FCFA, 0 pour aucune)
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
            Comment s’applique-t-elle ?
          </legend>
          <label class="flex min-h-touch items-center gap-3 text-sm">
            <input
              v-model="form.penaltyPeriod"
              type="radio"
              value="once"
              class="size-5 accent-brand"
            >
            Une seule fois, passé le délai
          </label>
          <label class="flex min-h-touch items-center gap-3 text-sm">
            <input
              v-model="form.penaltyPeriod"
              type="radio"
              value="per_day"
              class="size-5 accent-brand"
            >
            Par jour de retard
          </label>
        </fieldset>

        <label
          v-if="form.penaltyPeriod === 'per_day' && form.penaltyAmount > 0"
          class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
          for="plafond-amende"
        >
          Plafond de l’amende (FCFA)
          <InputText
            id="plafond-amende"
            :value="form.penaltyCap ?? ''"
            inputmode="numeric"
            data-testid="champ-plafond-amende"
            @input="form.penaltyCap = Number(($event.target as HTMLInputElement).value.replace(/\D/g, '')) || null"
          />
          <span class="text-sm font-normal text-ink-subtle">
            Une amende journalière sans plafond finit par dépasser la cotisation
            elle-même.
          </span>
        </label>

        <label
          class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
          for="grace"
        >
          Délai de grâce (jours)
          <InputText
            id="grace"
            :value="form.graceDays"
            inputmode="numeric"
            data-testid="champ-grace"
            @input="form.graceDays = Number(($event.target as HTMLInputElement).value.replace(/\D/g, '')) || 0"
          />
        </label>
      </section>

      <!-- Étape 5 — Récapitulatif -->
      <section
        v-else
        class="flex flex-col gap-3"
        data-testid="etape-recapitulatif"
      >
        <div class="flex flex-col gap-2 rounded-card border border-line bg-surface p-4">
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
            par part
          </p>
          <p
            v-if="simulation"
            class="text-sm text-ink-muted"
          >
            {{ simulation }}
          </p>
          <p class="text-sm text-ink-muted">
            Ordre de passage :
            {{ form.rotationMode === 'draw' ? 'tirage au sort' : 'fixe' }}
          </p>
        </div>

        <p class="text-sm text-ink-muted">
          Après publication, tu pourras ajouter les membres et leur envoyer le lien
          d’invitation.
        </p>
      </section>

      <p
        v-if="erreur"
        role="alert"
        class="rounded-control bg-disputed-surface p-3 text-sm text-disputed-ink"
        data-testid="erreur-wizard"
      >
        {{ erreur }}
      </p>

      <!-- Règle 13 : les actions primaires en bas d'écran. -->
      <div class="mt-auto flex flex-col gap-2 pt-2 sm:flex-row-reverse">
        <Button
          v-if="brouillon.etape < ETAPES.length - 1"
          :label="enregistrement ? 'Enregistrement…' : 'Continuer'"
          :disabled="!peutAvancer || enregistrement"
          class="bg-brand text-brand-ink hover:bg-brand-strong sm:flex-1"
          data-testid="bouton-continuer"
          @click="suivant"
        />
        <Button
          v-else
          :label="enregistrement ? 'Publication…' : 'Publier la tontine'"
          :disabled="enregistrement"
          class="bg-brand text-brand-ink hover:bg-brand-strong sm:flex-1"
          data-testid="bouton-publier"
          @click="publier"
        />

        <Button
          v-if="brouillon.etape > 0"
          label="Retour"
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
