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
 * Trois règles portées par cet écran :
 *
 * 1. **Le titulaire est obligatoire.** C'est ce que le membre lit dans son
 *    application de paiement pour vérifier qu'il envoie à la bonne personne
 *    (T14) — la protection anti-arnaque n°1.
 * 2. **Un canal naît non vérifié, donc inutilisable.** Le serveur refuse de le
 *    rattacher à une tontine tant qu'il ne l'est pas.
 * 3. **Le code part sur le numéro de collecte lui-même**, pas sur celui du
 *    compte. C'est ce qui prouve que l'organisateur contrôle ce numéro : on
 *    peut déclarer le numéro de n'importe qui.
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
  verifiedAt: string | null
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
})
const [provider] = formulaire.champ('provider')
const [holderName, holderNameAttrs] = formulaire.champ('holderName')
const form = reactive({
  saisieNumero: '',
  paymentLinkUrl: '',
})
const numeroAffiche = computed(() => formatTel(form.saisieNumero))

watch(() => form.saisieNumero, v => formulaire.setFieldValue('msisdn', v))
watch(() => form.paymentLinkUrl, v => formulaire.setFieldValue('paymentLinkUrl', v.trim() || undefined))

const lienValide = computed(() =>
  form.paymentLinkUrl.trim() === '' || /^https:\/\/\S+$/.test(form.paymentLinkUrl.trim()),
)
const formValide = computed(() =>
  estComplet(form.saisieNumero) && (holderName.value ?? '').trim().length >= 3 && lienValide.value,
)

/** Vérification en cours : l'identifiant du canal, et le code saisi. */
const verification = ref<{ canalId: string, code: string, devCode: string | null } | null>(null)
const secondesAvantRenvoi = ref(0)
let minuterie: ReturnType<typeof setInterval> | undefined

function lancerCompteARebours(secondes: number) {
  secondesAvantRenvoi.value = secondes
  clearInterval(minuterie)
  minuterie = setInterval(() => {
    secondesAvantRenvoi.value--
    if (secondesAvantRenvoi.value <= 0) clearInterval(minuterie)
  }, 1000)
}
onBeforeUnmount(() => clearInterval(minuterie))

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
    const { id } = await $fetch<{ id: string }>('/api/v1/me/channels', {
      method: 'POST',
      body: valeurs,
    })
    ajoutOuvert.value = false
    form.saisieNumero = ''
    form.paymentLinkUrl = ''
    formulaire.resetForm({ values: { provider: 'wave', msisdn: '', holderName: '', paymentLinkUrl: undefined } })
    await charger()
    // On enchaîne sur la vérification : un canal non vérifié ne sert à rien,
    // et repartir le chercher dans la liste est une étape de plus pour rien.
    await demanderCode(id)
  }
  catch (e) {
    erreur.value = message(e)
  }
  finally {
    enCours.value = false
  }
}

/** Envoie un code sur le numéro de collecte. Corps vide = demande d'envoi. */
async function demanderCode(canalId: string) {
  erreur.value = null
  enCours.value = true
  try {
    const reponse = await $fetch<{ resendAfterSeconds: number, devCode?: string }>(
      `/api/v1/me/channels/${canalId}/verify`,
      { method: 'POST', body: {} },
    )
    verification.value = { canalId, code: '', devCode: reponse.devCode ?? null }
    lancerCompteARebours(reponse.resendAfterSeconds)
  }
  catch (e) {
    erreur.value = message(e)
  }
  finally {
    enCours.value = false
  }
}

async function valider() {
  const en = verification.value
  if (!en) return

  erreur.value = null
  enCours.value = true
  try {
    await $fetch(`/api/v1/me/channels/${en.canalId}/verify`, {
      method: 'POST',
      body: { code: en.code },
    })
    verification.value = null
    clearInterval(minuterie)
    await charger()
  }
  catch (e) {
    if (verification.value) verification.value.code = ''
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
 * On arrive souvent ici depuis le wizard, faute de canal vérifié. Sans ce
 * retour, l'organisateur qui vient d'en vérifier un doit retrouver son
 * brouillon tout seul — et beaucoup ne le retrouvent pas.
 *
 * La destination n'est acceptée que si elle est **interne**, comme sur l'écran
 * de connexion : un `redirect=` vers un autre domaine ferait de cette page un
 * tremplin d'hameçonnage.
 */
const retourDemande = computed(() => {
  const demandee = useRoute().query.redirect
  return typeof demandee === 'string' && /^\/(?!\/)/.test(demandee) ? demandee : null
})

const auMoinsUnVerifie = computed(() => canaux.value.some(c => c.verifiedAt !== null))

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
        v-if="retourDemande && auMoinsUnVerifie"
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

      <!-- Vérification en cours : elle prend tout l'écran tant qu'elle dure.
           Un code à saisir au milieu d'une liste se perd. -->
      <section
        v-if="verification"
        class="card-surface flex flex-col gap-4 p-4"
        data-testid="bloc-verification"
      >
        <div class="flex flex-col gap-1">
          <h2 class="font-semibold text-ink">
            {{ $t('profil.canaux.verifie_ce_numero') }}
          </h2>
          <p class="text-sm text-ink-muted">
            {{ $t('profil.canaux.un_code_a_six') }} <strong class="text-ink">{{ $t('profil.canaux.sur_le_numero_de') }}</strong>{{ $t('profil.canaux.c_est_ce_qui') }}
          </p>
        </div>

        <InputOtp
          v-model="verification.code"
          :length="6"
          integer-only
          data-testid="champ-code-canal"
        />

        <p
          v-if="verification.devCode"
          class="rounded-control bg-late-surface p-2 text-sm text-late-ink"
          data-testid="code-dev-canal"
        >
          {{ $t('profil.canaux.developpement_code') }} <strong>{{ verification.devCode }}</strong>
        </p>

        <div class="flex flex-col gap-2">
          <Button
            :label="enCours ? $t('commun.verification_en_cours') : $t('profil.canaux.valider_le_code')"
            :disabled="verification.code.length !== 6 || enCours"
            class="w-full bg-brand text-brand-ink hover:bg-brand-strong"
            data-testid="bouton-valider-canal"
            @click="valider"
          />
          <button
            type="button"
            class="min-h-touch text-sm text-brand underline underline-offset-4 disabled:text-ink-subtle disabled:no-underline"
            :disabled="secondesAvantRenvoi > 0 || enCours"
            data-testid="bouton-renvoyer-canal"
            @click="demanderCode(verification.canalId)"
          >
            {{ secondesAvantRenvoi > 0
              ? $t('profil.canaux.renvoyer_le_code_dans', { s: secondesAvantRenvoi })
              : $t('commun.renvoyer_le_code') }}
          </button>
          <button
            type="button"
            class="min-h-touch text-sm text-ink-muted underline underline-offset-4"
            @click="verification = null"
          >
            {{ $t('profil.canaux.plus_tard') }}
          </button>
        </div>
      </section>

      <template v-else>
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

              <!-- Couleur + icône + mot (règle 10) : « vérifié » ne se devine
                   pas à une teinte. -->
              <span
                v-if="canal.verifiedAt"
                class="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-confirmed-surface px-2.5 py-1 text-xs font-semibold text-confirmed-ink"
                :data-testid="`etat-canal-${canal.id}`"
              >
                <Icon
                  name="lucide:circle-check"
                  size="0.875rem"
                  aria-hidden="true"
                />
                {{ $t('profil.canaux.verifie') }}
              </span>
              <span
                v-else
                class="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-late-surface px-2.5 py-1 text-xs font-semibold text-late-ink"
                :data-testid="`etat-canal-${canal.id}`"
              >
                <Icon
                  name="lucide:triangle-alert"
                  size="0.875rem"
                  aria-hidden="true"
                />
                {{ $t('profil.canaux.a_verifier') }}
              </span>
            </div>

            <p
              v-if="!canal.verifiedAt"
              class="text-sm text-ink-muted"
            >
              {{ $t('profil.canaux.tant_qu_il_n') }}
            </p>

            <div class="flex flex-col gap-2 sm:flex-row">
              <button
                v-if="!canal.verifiedAt"
                type="button"
                class="min-h-touch inline-flex items-center justify-center gap-2 rounded-control bg-brand px-4 text-sm font-semibold text-brand-ink sm:flex-1"
                :disabled="enCours"
                :data-testid="`bouton-verifier-${canal.id}`"
                @click="demanderCode(canal.id)"
              >
                {{ $t('profil.canaux.verifier_par_sms') }}
              </button>
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

          <div class="flex flex-col gap-2">
            <Button
              :label="enCours ? $t('profil.canaux.enregistrement') : $t('profil.canaux.ajouter_et_verifier')"
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
