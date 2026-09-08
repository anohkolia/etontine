<script setup lang="ts">
/**
 * Vérification d'identité — palier KYC 2.
 *
 * Exigé pour publier une tontine, et pour choisir l'accès « ouvert ». Deux
 * pièces, déposées différemment parce qu'elles ne prouvent pas la même chose :
 *
 * - la **pièce d'identité** est un document existant, souvent déjà scanné —
 *   PDF, JPG, JPEG ou PNG, pris là où il se trouve ;
 * - le **selfie** est pris en direct à la caméra. Une photo de galerie peut
 *   être celle de n'importe qui : c'est la prise de vue au moment du dépôt qui
 *   donne sa valeur à la comparaison des deux.
 *
 * Hors production, le dossier est approuvé immédiatement — l'écran le dit sans
 * détour plutôt que de laisser croire à un contrôle qui n'existe pas.
 */
definePageMeta({ layout: 'app', middleware: 'auth' })

const session = useSessionStore()
const route = useRoute()
const { compresser } = useCompressionImage()

/** Ce que le serveur accepte pour la pièce d'identité (`POST /me/kyc/piece`). */
const FORMATS = 'application/pdf,image/jpeg,image/png'
const PLAFOND_PDF_OCTETS = 2 * 1024 * 1024

const piece = ref<File | null>(null)
const nomPiece = ref<string | null>(null)
const poidsPiece = ref<number | null>(null)

const selfie = ref<File | null>(null)
const poidsSelfie = ref<number | null>(null)

const envoi = ref(false)
const resultat = ref<string | null>(null)
const erreur = ref<string | null>(null)

const dejaVerifie = computed(() => (session.user?.kycLevel ?? 0) >= 2)

/**
 * L'écran n'avait que deux états : vérifié, ou dépose tes pièces.
 *
 * Il en manquait deux, et ce sont ceux qui comptent. **En examen** : sans lui,
 * quelqu'un qui vient de déposer revoit le formulaire et redépose, persuadé
 * que rien n'est parti. **Refusé** : le back-office exige un motif d'au moins
 * dix caractères, la notification renvoie ici « pour voir ce qui doit être
 * corrigé », et le motif n'arrivait jamais jusqu'à cet écran. On demandait à
 * quelqu'un de corriger sans lui dire quoi.
 */
const enExamen = computed(() =>
  !dejaVerifie.value && session.user?.kycStatus === 'pending_review',
)
const refuse = computed(() =>
  !dejaVerifie.value && session.user?.kycStatus === 'rejected',
)
const motifRefus = computed(() => session.user?.kycRejectionReason ?? null)
const complet = computed(() => piece.value !== null && selfie.value !== null)

/**
 * Un PDF part tel quel : on ne sait pas le compresser dans le navigateur, et le
 * plafond serveur de 2 Mo est vérifié ici pour éviter un aller-retour inutile
 * sur un forfait à la donnée. Une image, elle, est réduite avant l'envoi
 * (règle 18).
 */
async function choisirPiece(evenement: Event) {
  const fichier = (evenement.target as HTMLInputElement).files?.[0]
  if (!fichier) return

  erreur.value = null
  try {
    if (fichier.type === 'application/pdf') {
      if (fichier.size > PLAFOND_PDF_OCTETS) {
        throw new Error('Ce PDF dépasse 2 Mo. Scanne la pièce en qualité plus basse.')
      }
      retenirPiece(fichier)
      return
    }

    if (fichier.type !== 'image/jpeg' && fichier.type !== 'image/png') {
      throw new Error('Formats acceptés : PDF, JPG, JPEG et PNG.')
    }

    retenirPiece(await compresser(fichier), fichier.name)
  }
  catch (e) {
    piece.value = null
    nomPiece.value = null
    poidsPiece.value = null
    erreur.value = (e as Error).message
  }
}

function retenirPiece(fichier: File, nomAffiche = fichier.name) {
  piece.value = fichier
  nomPiece.value = nomAffiche
  poidsPiece.value = fichier.size
}

function retenirSelfie(fichier: File) {
  selfie.value = fichier
  poidsSelfie.value = fichier.size
}

async function deposer(fichier: File): Promise<string> {
  const formulaire = new FormData()
  formulaire.append('file', fichier)
  const { url } = await $fetch<{ url: string }>('/api/v1/me/kyc/piece', {
    method: 'POST',
    body: formulaire,
  })
  return url
}

async function envoyer() {
  if (!piece.value || !selfie.value) return

  erreur.value = null
  envoi.value = true
  try {
    // Les deux pièces d'abord, le dossier ensuite : le serveur refuse une
    // adresse qui ne désigne pas un fichier déposé par l'appelant.
    const documentUrl = await deposer(piece.value)
    const selfieUrl = await deposer(selfie.value)

    const reponse = await $fetch<{ status: string }>('/api/v1/me/kyc', {
      method: 'POST',
      body: { documentUrl, selfieUrl },
    })
    await session.charger(true)

    resultat.value = reponse.status === 'approved'
      ? 'Identité vérifiée.'
      : 'Dossier reçu. Il sera examiné avant validation.'

    const redirection = route.query.redirect
    if (reponse.status === 'approved' && typeof redirection === 'string' && redirection.startsWith('/')) {
      await navigateTo(redirection)
    }
  }
  catch (e) {
    erreur.value = (e as { data?: { error?: { message?: string } } })?.data?.error?.message
      ?? 'Impossible de joindre le serveur.'
  }
  finally {
    envoi.value = false
  }
}

useEnTete(() => ({
  titre: 'Vérifier mon identité',
  sousTitre: 'Palier 2',
  retour: { to: '/app/profil', label: 'Mon profil' },
}))
useHead({ title: 'Vérifier mon identité — eTontine' })
</script>

<template>
  <div class="flex flex-col gap-5">
    <p class="text-sm text-ink-muted">
      Une pièce d’identité et un selfie. C’est ce qui permet de publier une
      tontine : les membres doivent savoir à qui ils confient leur argent.
    </p>

    <!-- Le résultat vit **hors** du formulaire : une approbation immédiate le
       remplace par le badge, et le message de confirmation disparaîtrait avec
       lui — on aurait envoyé sa pièce d'identité sans rien lire en retour. -->
    <p
      v-if="resultat"
      role="status"
      class="rounded-control bg-confirmed-surface p-3 text-sm text-confirmed-ink"
      data-testid="resultat-identite"
    >
      {{ resultat }}
    </p>

    <StatusBadge
      v-if="dejaVerifie"
      kind="membership"
      status="active"
      data-testid="identite-verifiee"
    />

    <!-- En examen : surtout, pas le formulaire. Le revoir ferait redéposer. -->
    <div
      v-else-if="enExamen"
      class="flex flex-col gap-3 card-surface p-4"
      data-testid="identite-en-examen"
    >
      <p class="flex items-start gap-2 text-sm text-ink">
        <Icon
          name="lucide:clock"
          size="1rem"
          class="mt-0.5 shrink-0"
          aria-hidden="true"
        />
        <span>
          <strong class="font-semibold">Ton dossier est en cours d’examen.</strong>
          Tu n’as rien à refaire. Tu recevras une notification dès qu’il aura
          été regardé.
        </span>
      </p>
    </div>

    <template v-else>
      <!-- Refusé : le motif d'abord, le formulaire ensuite. Demander de
           corriger sans dire quoi ne mène qu'à un second refus. -->
      <p
        v-if="refuse && motifRefus"
        class="flex items-start gap-2 rounded-control bg-disputed-surface p-3 text-sm text-disputed-ink"
        data-testid="motif-refus-identite"
      >
        <Icon
          name="lucide:octagon-alert"
          size="1rem"
          class="mt-0.5 shrink-0"
          aria-hidden="true"
        />
        <span>
          <strong class="font-semibold">Ton dossier n’a pas été accepté.</strong>
          {{ motifRefus }} Corrige, puis redépose tes pièces ci-dessous.
        </span>
      </p>

      <form
        class="flex flex-col gap-5"
        @submit.prevent="envoyer"
      >
        <div class="flex flex-col gap-2">
          <label
            class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
            for="piece"
          >
            Ma pièce d’identité
            <span class="text-sm font-normal text-ink-subtle">
              CNI, passeport ou permis de conduire — PDF, JPG, JPEG ou PNG, 2 Mo maximum.
            </span>
            <input
              id="piece"
              type="file"
              :accept="FORMATS"
              class="min-h-touch rounded-control border border-line-strong bg-surface p-2 text-sm"
              data-testid="champ-piece"
              @change="choisirPiece"
            >
          </label>
          <p
            v-if="nomPiece && poidsPiece !== null"
            class="flex items-start gap-1.5 text-sm text-confirmed-ink"
            data-testid="piece-retenue"
          >
            <Icon
              name="lucide:file-text"
              size="0.875rem"
              class="mt-0.5 shrink-0"
              aria-hidden="true"
            />
            {{ nomPiece }} — {{ Math.max(1, Math.round(poidsPiece / 1024)) }} Ko
          </p>
        </div>

        <div class="flex flex-col gap-2">
          <p class="text-sm font-medium text-ink-muted">
            Mon selfie
            <span class="block font-normal text-ink-subtle">
              Pris maintenant, à la caméra : c’est ce qui permet de comparer ton
              visage à ta pièce.
            </span>
          </p>
          <SelfieCamera
            :poids="poidsSelfie"
            @prise="retenirSelfie"
          />
        </div>

        <p
          v-if="erreur"
          role="alert"
          class="rounded-control bg-disputed-surface p-3 text-sm text-disputed-ink"
          data-testid="erreur-identite"
        >
          {{ erreur }}
        </p>
        <Button
          type="submit"
          :label="envoi ? 'Envoi…' : 'Envoyer mon dossier'"
          :disabled="envoi || !complet"
          class="bg-brand text-brand-ink hover:bg-brand-strong"
          data-testid="bouton-envoyer-identite"
        />
      </form>
    </template>
  </div>
</template>

<!--
  États d'écran (règle 14) :
  · chargement — indiqué dans le libellé du bouton (« Envoi… »)
  · vide       — sans objet : le formulaire est toujours présent
  · erreur     — message en ligne avec `role="alert"`
  · hors-ligne — bandeau porté par `layouts/app.vue`
  · contenu    — le formulaire, ou le badge « vérifié »
-->
