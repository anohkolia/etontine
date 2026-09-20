<script setup lang="ts">
import type { paymentChannel } from '#shared/schemas'
import { collectionChannelInput } from '#shared/schemas'
import type { z } from 'zod'
import { PAYMENT_CHANNEL } from '#shared/constants/statuts'

/**
 * Mes numéros de collecte (T09).
 *
 * L'écran manquait : `POST /me/channels` et sa vérification par OTP existaient
 * côté serveur, testés unitairement, mais aucune page ne les appelait. Le
 * wizard se contentait de **lister** les canaux déjà vérifiés — un organisateur
 * qui venait de s'inscrire n'en avait aucun, voyait un état vide sans action,
 * et ne pouvait pas créer de tontine. Le parcours s'arrêtait là.
 *
 * L'écran vit dans le profil et non dans le wizard parce qu'un canal appartient
 * à **l'utilisateur** (`/me/channels`), pas à une tontine : il se réutilise
 * d'une tontine à l'autre. L'enfermer dans le wizard obligerait à le ressaisir
 * à chaque création.
 *
 * Deux règles portées par cet écran :
 *
 * 1. **Le titulaire est obligatoire.** C'est ce que le membre lit dans son
 *    application de paiement pour vérifier qu'il envoie à la bonne personne
 *    (T14) — la protection anti-arnaque n°1.
 * 2. **Le code d'accès est redemandé pour déclarer un numéro.** C'est là que
 *    l'argent des membres va partir : une session ouverte sur un téléphone
 *    prêté ne doit pas suffire. Le numéro n'est plus prouvé par SMS ; le gel
 *    de 48 h et la notification à tous restent sur une tontine lancée.
 */
definePageMeta({ layout: 'app', middleware: 'auth' })
const { t } = useI18n()
const { canal: motDuCanal } = useLibelle()

const { format: formatTel, extraire, estComplet } = usePhoneMask()

interface Canal {
  id: string
  provider: 'wave' | 'orange' | 'mtn' | 'moov'
  msisdn: string
  holderName: string
  paymentLinkUrl: string | null
}

const OPERATEURS = ['wave', 'orange', 'mtn', 'moov'] as const

const etat = ref<'chargement' | 'contenu' | 'erreur'>('chargement')
const canaux = ref<Canal[]>([])
const erreur = ref<string | null>(null)

/** Formulaire d'ajout. Replié tant qu'on n'a pas demandé à ajouter. */
const ajoutOuvert = ref(false)
const enCours = ref(false)
/**
 * Le formulaire est validé par `collectionChannelInput`, le schéma que le
 * serveur applique : même règle sur le numéro, le titulaire et le lien.
 *
 * Le numéro est saisi au format local, masqué à l'écran, et posé dans le
 * formulaire tel que tapé : c'est le schéma qui le normalise en E.164 à
 * l'envoi, comme il le ferait côté serveur.
 *
 * Le lien de paiement — celui que Wave donne à un commerçant — était prévu
 * par le modèle et affiché à l'écran « où envoyer » sans qu'aucun formulaire
 * permette de le saisir. Facultatif ; vide, il n'est pas envoyé du tout.
 */
const formulaire = useFormulaire(collectionChannelInput, {
  provider: 'wave',
  msisdn: '',
  holderName: '',
  paymentLinkUrl: undefined,
  code: '',
})
const [provider] = formulaire.champ('provider')
const [holderName, holderNameAttrs] = formulaire.champ('holderName')
const form = reactive({
  saisieNumero: '',
  paymentLinkUrl: '',
  code: '',
})
const numeroAffiche = computed(() => formatTel(form.saisieNumero))

watch(() => form.saisieNumero, v => formulaire.setFieldValue('msisdn', v))
watch(() => form.paymentLinkUrl, v => formulaire.setFieldValue('paymentLinkUrl', v.trim() || undefined))
watch(() => form.code, v => formulaire.setFieldValue('code', v, false))

const lienValide = computed(() =>
  form.paymentLinkUrl.trim() === '' || /^https:\/\/\S+$/.test(form.paymentLinkUrl.trim()),
)
const formValide = computed(() =>
  estComplet(form.saisieNumero) && (holderName.value ?? '').trim().length >= 3 && lienValide.value
  && /^\d{4}$/.test(form.code),
)

function message(e: unknown): string {
  return (e as { data?: { error?: { message?: string } } })?.data?.error?.message
    ?? t('commun.serveur_injoignable')
}

function presentation(provider: string) {
  return PAYMENT_CHANNEL[provider as z.infer<typeof paymentChannel>]
}

async function charger() {
  etat.value = 'chargement'
  try {
    canaux.value = await $fetch<Canal[]>('/api/v1/me/channels')
    etat.value = 'contenu'
  }
  catch (e) {
    erreur.value = message(e)
    etat.value = 'erreur'
  }
}

async function ajouter() {
  erreur.value = null
  const valeurs = await formulaire.valider()
  if (!valeurs) return
  enCours.value = true
  try {
    await $fetch<{ id: string }>('/api/v1/me/channels', {
      method: 'POST',
      body: valeurs,
    })
    ajoutOuvert.value = false
    form.saisieNumero = ''
    form.paymentLinkUrl = ''
    form.code = ''
    formulaire.resetForm({ values: { provider: 'wave', msisdn: '', holderName: '', paymentLinkUrl: undefined, code: '' } })
    await charger()
  }
  catch (e) {
    form.code = ''
    erreur.value = message(e)
  }
  finally {
    enCours.value = false
  }
}

async function supprimer(canalId: string) {
  erreur.value = null
  try {
    await $fetch(`/api/v1/me/channels/${canalId}`, { method: 'DELETE' })
    await charger()
  }
  catch (e) {
    // Le serveur refuse de supprimer un canal encore rattaché à une tontine,
    // et son message dit quoi faire. On le montre tel quel.
    erreur.value = message(e)
  }
}

/**
 * Retour à l'intention initiale.
 *
 * On arrive souvent ici depuis le wizard, faute de canal. Sans ce retour,
 * l'organisateur qui vient d'en déclarer un doit retrouver son brouillon
 * tout seul — et beaucoup ne le retrouvent pas.
 *
 * La destination n'est acceptée que si elle est **interne**, comme sur l'écran
 * de connexion : un `redirect=` vers un autre domaine ferait de cette page un
 * tremplin d'hameçonnage.
 */
const retourDemande = computed(() => {
  const demandee = useRoute().query.redirect
  return typeof demandee === 'string' && /^\/(?!\/)/.test(demandee) ? demandee : null
})

const auMoinsUn = computed(() => canaux.value.length > 0)

onMounted(charger)

useEnTete(() => ({
  titre: t('profil.canaux.mes_numeros_de_collecte'),
  sousTitre: t('profil.canaux.la_ou_les_membres'),
  retour: { to: '/app/profil', label: t('commun.mon_profil') },
}))
useHead({ title: t('profil.canaux.mes_numeros_de_collecte_2') })
</script>

<template>
  <div class="flex flex-col gap-5">
    <LoadingSkeleton
      v-if="etat === 'chargement'"
      variant="list"
      :count="2"
    />

    <ErrorState
      v-else-if="etat === 'erreur'"
      :detail="erreur ?? undefined"
      @retry="charger"
    />

    <template v-else>
      <NuxtLink
        v-if="retourDemande && auMoinsUn"
        :to="retourDemande"
        class="min-h-touch inline-flex items-center justify-center gap-2 rounded-control bg-brand px-5 font-semibold text-brand-ink"
        data-testid="lien-retour-intention"
      >
        <Icon
          name="lucide:arrow-left"
          size="1rem"
          aria-hidden="true"
        />
        {{ $t('profil.canaux.revenir_a_ma_tontine') }}
      </NuxtLink>

      <p
        v-if="erreur"
        role="alert"
        class="flex items-start gap-2 rounded-control bg-disputed-surface p-3 text-sm text-disputed-ink"
        data-testid="erreur-canaux"
      >
        <Icon
          name="lucide:octagon-alert"
          size="1rem"
          class="mt-0.5 shrink-0"
          aria-hidden="true"
        />
        {{ erreur }}
      </p>

      <EmptyState
        v-if="canaux.length === 0 && !ajoutOuvert"
        :title="$t('profil.canaux.aucun_numero_de_collecte')"
        :description="$t('profil.canaux.c_est_le_numero')"
        icon="lucide:smartphone"
      >
        <template #action>
          <button
            type="button"
            class="min-h-touch inline-flex items-center justify-center gap-2 rounded-control bg-brand px-5 font-semibold text-brand-ink"
            data-testid="bouton-ouvrir-ajout"
            @click="ajoutOuvert = true"
          >
            <Icon
              name="lucide:plus"
              size="1rem"
              aria-hidden="true"
            />
            {{ $t('profil.canaux.ajouter_un_numero') }}
          </button>
        </template>
      </EmptyState>

      <ul
        v-else-if="canaux.length > 0"
        class="flex flex-col gap-2"
        data-testid="liste-canaux"
      >
        <li
          v-for="canal in canaux"
          :key="canal.id"
          class="card-surface flex flex-col gap-3 p-3"
          :data-testid="`canal-${canal.id}`"
        >
          <div class="flex items-start gap-3">
            <CanalPill
              :canal="canal.provider"
              compact
            />
            <div class="flex min-w-0 flex-1 flex-col">
              <span class="truncate font-semibold text-ink">{{ canal.holderName }}</span>
              <span class="tabular truncate text-sm text-ink-muted">{{ canal.msisdn }}</span>
            </div>
          </div>

          <div class="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              class="min-h-touch inline-flex items-center justify-center gap-2 rounded-control border border-line-strong bg-surface px-4 text-sm font-semibold text-ink sm:flex-1"
              :data-testid="`bouton-supprimer-${canal.id}`"
              @click="supprimer(canal.id)"
            >
              <Icon
                name="lucide:trash-2"
                size="1rem"
                aria-hidden="true"
              />
              {{ $t('profil.canaux.retirer') }}
            </button>
          </div>
        </li>
      </ul>

      <!-- Formulaire d'ajout -->
      <section
        v-if="ajoutOuvert"
        class="card-surface flex flex-col gap-4 p-4"
        data-testid="formulaire-canal"
      >
        <h2 class="font-semibold text-ink">
          {{ $t('profil.canaux.nouveau_numero_de_collecte') }}
        </h2>

        <fieldset class="flex flex-col gap-2">
          <legend class="pb-1 text-sm font-medium text-ink-muted">
            {{ $t('profil.canaux.service_de_paiement') }}
          </legend>
          <div class="flex flex-wrap gap-2">
            <label
              v-for="operateur in OPERATEURS"
              :key="operateur"
              class="flex min-h-touch cursor-pointer items-center gap-2 rounded-control border px-3 text-sm font-semibold transition-colors"
              :class="provider === operateur
                ? 'border-brand bg-brand-surface text-brand-strong'
                : 'border-line bg-surface text-ink-muted'"
            >
              <input
                v-model="provider"
                type="radio"
                :value="operateur"
                class="sr-only"
                :data-testid="`operateur-${operateur}`"
              >
              <Icon
                :name="presentation(operateur).icon"
                size="1rem"
                aria-hidden="true"
              />
              {{ motDuCanal(operateur, presentation(operateur).label) }}
            </label>
          </div>
        </fieldset>

        <label
          class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
          for="numero-collecte"
        >
          {{ $t('profil.canaux.numero_qui_recevra_les') }}
          <span class="flex items-stretch gap-2">
            <span class="flex min-h-touch shrink-0 items-center rounded-control border border-line bg-surface-muted px-3 text-base font-semibold text-ink">
              +225
            </span>
            <InputText
              id="numero-collecte"
              :value="numeroAffiche"
              inputmode="tel"
              placeholder="07 07 12 34 56"
              class="text-lg tracking-wider tabular-nums"
              :aria-invalid="Boolean(formulaire.erreur('msisdn'))"
              data-testid="champ-numero-collecte"
              @input="(e: Event) => form.saisieNumero = extraire((e.target as HTMLInputElement).value)"
            />
          </span>
          <ErreurChamp :message="formulaire.erreur('msisdn')" />
        </label>

        <label
          class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
          for="titulaire"
        >
          {{ $t('profil.canaux.nom_du_titulaire_du') }}
          <InputText
            id="titulaire"
            v-model="holderName"
            v-bind="holderNameAttrs"
            :placeholder="$t('profil.canaux.aya_kone')"
            :aria-invalid="Boolean(formulaire.erreur('holderName'))"
            data-testid="champ-titulaire"
          />
          <ErreurChamp :message="formulaire.erreur('holderName')" />
          <!-- Obligatoire, et on dit pourquoi : c'est ce nom que le membre
               compare à ce qu'affiche son application avant de valider. -->
          <span class="text-sm font-normal text-ink-subtle">
            {{ $t('profil.canaux.ecris_le_exactement_comme') }}
          </span>
        </label>

        <label
          class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
          for="lien-paiement"
        >
          {{ $t('profil.canaux.lien_de_paiement_facultatif') }}
          <InputText
            id="lien-paiement"
            v-model="form.paymentLinkUrl"
            type="url"
            inputmode="url"
            :placeholder="$t('profil.canaux.https_pay_wave_com')"
            data-testid="champ-lien-paiement"
          />
          <span class="text-sm font-normal text-ink-subtle">
            {{ $t('profil.canaux.si_ton_application_te') }}
          </span>
          <span
            v-if="!lienValide"
            class="text-sm font-normal text-disputed-ink"
            role="alert"
            data-testid="erreur-lien-paiement"
          >
            {{ $t('profil.canaux.le_lien_doit_commencer') }}
          </span>
        </label>

        <label
          class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
          for="code-canal"
        >
          {{ $t('profil.canaux.ton_code_pour_confirmer') }}
          <InputText
            id="code-canal"
            v-model="form.code"
            type="password"
            inputmode="numeric"
            autocomplete="current-password"
            maxlength="4"
            class="tracking-[0.5em]"
            :aria-invalid="Boolean(formulaire.erreur('code'))"
            data-testid="champ-code-canal"
          />
          <ErreurChamp :message="formulaire.erreur('code')" />
          <span class="text-sm font-normal text-ink-subtle">
            {{ $t('profil.canaux.c_est_la_que_l_argent') }}
          </span>
        </label>

        <div class="flex flex-col gap-2">
          <Button
            :label="enCours ? $t('profil.canaux.enregistrement') : $t('profil.canaux.ajouter')"
            :disabled="!formValide || enCours"
            class="w-full bg-brand text-brand-ink hover:bg-brand-strong"
            data-testid="bouton-ajouter-canal"
            @click="ajouter"
          />
          <button
            type="button"
            class="min-h-touch text-sm text-ink-muted underline underline-offset-4"
            @click="ajoutOuvert = false"
          >
            {{ $t('profil.canaux.annuler') }}
          </button>
        </div>
      </section>

      <button
        v-else-if="canaux.length > 0"
        type="button"
        class="min-h-touch inline-flex items-center justify-center gap-2 rounded-control border border-line-strong bg-surface px-5 font-semibold text-ink"
        data-testid="bouton-ouvrir-ajout"
        @click="ajoutOuvert = true"
      >
        <Icon
          name="lucide:plus"
          size="1rem"
          aria-hidden="true"
        />
        {{ $t('profil.canaux.ajouter_un_numero') }}
      </button>
    </template>
  </div>
</template>

<!--
  États d'écran (règle 14) :
  · chargement — LoadingSkeleton
  · vide       — EmptyState, avec l'action qui manquait jusqu'ici
  · erreur     — ErrorState au chargement, message en ligne sur les actions
  · hors-ligne — bandeau porté par `layouts/app.vue`
  · contenu    — la liste et le formulaire
-->
