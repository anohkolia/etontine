<script setup lang="ts">
/**
 * Prise d'un selfie **en direct**, à la caméra de l'appareil.
 *
 * Pourquoi pas un simple champ fichier : un selfie sert à comparer un visage à
 * une pièce d'identité. Une photo choisie dans la galerie peut être celle de
 * n'importe qui, prise n'importe quand — elle ne prouve rien. Le flux vidéo ne
 * rend pas la fraude impossible, mais il la rend délibérée.
 *
 * Le repli existe et il est assumé : sans caméra accessible (ordinateur de
 * bureau, autorisation refusée, contexte non sécurisé), on propose le champ
 * fichier avec `capture="user"`, qui ouvre l'appareil photo frontal sur
 * téléphone. Bloquer la vérification faute de `getUserMedia` reviendrait à
 * exclure des organisateurs sans autre motif que leur matériel.
 */
const proprietes = defineProps<{
  /** Poids de l'image retenue, une fois compressée. `null` tant qu'il n'y en a pas. */
  poids: number | null
}>()

const emit = defineEmits<{ prise: [fichier: File] }>()

const { compresser } = useCompressionImage()

const video = ref<HTMLVideoElement | null>(null)
const flux = shallowRef<MediaStream | null>(null)
const etat = ref<'inactive' | 'demarrage' | 'directe' | 'prise' | 'indisponible'>('inactive')
const apercu = ref<string | null>(null)
const erreur = ref<string | null>(null)

const aUnSelfie = computed(() => proprietes.poids !== null)

async function demarrer() {
  erreur.value = null
  etat.value = 'demarrage'

  if (!navigator.mediaDevices?.getUserMedia) {
    etat.value = 'indisponible'
    return
  }

  try {
    flux.value = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 } },
      audio: false,
    })

    const source = video.value
    if (!source) throw new Error('Aperçu indisponible.')

    source.srcObject = flux.value
    await source.play()

    // On n'annonce la caméra prête qu'une fois une image réellement disponible.
    // Entre `play()` et la première trame, `videoWidth` vaut zéro : capturer là
    // donne un canevas de taille nulle, donc une photo vide — et l'on ne s'en
    // aperçoit qu'au moment où un administrateur ouvre le dossier.
    await premiereTrame(source)
    etat.value = 'directe'
  }
  catch {
    // Refus, caméra occupée, page non servie en HTTPS, flux muet : le message
    // est le même, et la sortie de secours aussi. Les pistes déjà ouvertes sont
    // coupées — laisser la caméra allumée derrière un écran de repli est le
    // genre de détail qui fait désinstaller une application.
    arreter()
    etat.value = 'indisponible'
  }
}

/** Attend que le flux ait produit une image mesurable. */
function premiereTrame(source: HTMLVideoElement): Promise<void> {
  if (source.videoWidth > 0) return Promise.resolve()

  return new Promise((resoudre, rejeter) => {
    const abandon = setTimeout(
      () => rejeter(new Error('La caméra n’a rien renvoyé.')),
      10_000,
    )
    source.addEventListener('loadeddata', () => {
      clearTimeout(abandon)
      resoudre()
    }, { once: true })
  })
}

function arreter() {
  flux.value?.getTracks().forEach(piste => piste.stop())
  flux.value = null
}

async function capturer() {
  const source = video.value
  if (!source) return

  if (!source.videoWidth || !source.videoHeight) {
    erreur.value = 'La caméra n’est pas encore prête. Réessaie dans un instant.'
    return
  }

  const canvas = document.createElement('canvas')
  canvas.width = source.videoWidth
  canvas.height = source.videoHeight

  const contexte = canvas.getContext('2d')
  if (!contexte) {
    erreur.value = 'Impossible de capturer l’image sur cet appareil.'
    return
  }
  contexte.drawImage(source, 0, 0, canvas.width, canvas.height)

  const blob = await new Promise<Blob | null>(resoudre =>
    canvas.toBlob(resoudre, 'image/jpeg', 0.9),
  )
  if (!blob) {
    erreur.value = 'Impossible de capturer l’image sur cet appareil.'
    return
  }

  arreter()
  etat.value = 'prise'

  const brut = new File([blob], 'selfie.jpg', { type: 'image/jpeg' })
  await retenir(brut)
}

/** Repli : l'appareil photo ouvert par le champ fichier. */
async function choisirFichier(evenement: Event) {
  const fichier = (evenement.target as HTMLInputElement).files?.[0]
  if (!fichier) return
  await retenir(fichier)
}

async function retenir(fichier: File) {
  erreur.value = null
  try {
    const compresse = await compresser(fichier)
    remplacerApercu(URL.createObjectURL(compresse))
    emit('prise', compresse)
  }
  catch (e) {
    erreur.value = (e as Error).message
  }
}

function remplacerApercu(url: string | null) {
  if (apercu.value) URL.revokeObjectURL(apercu.value)
  apercu.value = url
}

async function reprendre() {
  remplacerApercu(null)
  await demarrer()
}

onBeforeUnmount(() => {
  arreter()
  remplacerApercu(null)
})
</script>

<template>
  <div class="flex flex-col gap-2">
    <!-- Aperçu de la photo retenue -->
    <img
      v-if="apercu"
      :src="apercu"
      alt="Selfie retenu"
      class="w-full max-w-xs rounded-control border border-line-strong"
      data-testid="apercu-selfie"
    >

    <!-- Flux en direct -->
    <!-- Aperçu inversé, comme un miroir : c'est ce qu'on attend en se
       regardant. La photo capturée, elle, ne l'est pas — on la compare à une
       pièce d'identité, elle doit être dans le bon sens. -->
    <video
      v-show="etat === 'directe'"
      ref="video"
      class="w-full max-w-xs -scale-x-100 rounded-control border border-line-strong bg-surface-muted"
      playsinline
      muted
      autoplay
      data-testid="camera-selfie"
    />

    <Button
      v-if="etat === 'inactive' && !aUnSelfie"
      type="button"
      label="Ouvrir la caméra"
      class="border border-line-strong bg-surface text-ink hover:bg-surface-muted"
      data-testid="bouton-ouvrir-camera"
      @click="demarrer"
    />

    <p
      v-else-if="etat === 'demarrage'"
      class="text-sm text-ink-subtle"
      role="status"
    >
      Ouverture de la caméra…
    </p>

    <Button
      v-else-if="etat === 'directe'"
      type="button"
      label="Prendre la photo"
      class="bg-brand text-brand-ink hover:bg-brand-strong"
      data-testid="bouton-capturer-selfie"
      @click="capturer"
    />

    <Button
      v-else-if="aUnSelfie"
      type="button"
      label="Reprendre la photo"
      class="border border-line-strong bg-surface text-ink hover:bg-surface-muted"
      data-testid="bouton-reprendre-selfie"
      @click="reprendre"
    />

    <!-- Repli : aucune caméra accessible. Couleur + icône + mot (règle 10). -->
    <div
      v-if="etat === 'indisponible' && !aUnSelfie"
      class="flex flex-col gap-2"
    >
      <p
        class="flex items-start gap-1.5 rounded-control bg-late-surface p-3 text-sm text-late-ink"
        role="status"
        data-testid="camera-indisponible"
      >
        <Icon
          name="lucide:camera-off"
          size="0.875rem"
          class="mt-0.5 shrink-0"
          aria-hidden="true"
        />
        Caméra inaccessible sur cet appareil. Prends la photo avec ton appareil
        photo, puis choisis-la ci-dessous.
      </p>
      <input
        id="selfie-repli"
        type="file"
        accept="image/jpeg,image/png"
        capture="user"
        class="min-h-touch rounded-control border border-line-strong bg-surface p-2 text-sm"
        data-testid="champ-selfie-repli"
        @change="choisirFichier"
      >
    </div>

    <p
      v-if="poids !== null"
      class="text-sm text-ink-subtle"
      data-testid="poids-selfie"
    >
      Photo compressée à {{ Math.max(1, Math.round(poids / 1024)) }} Ko avant envoi.
    </p>

    <p
      v-if="erreur"
      role="alert"
      class="rounded-control bg-disputed-surface p-3 text-sm text-disputed-ink"
      data-testid="erreur-selfie"
    >
      {{ erreur }}
    </p>
  </div>
</template>
