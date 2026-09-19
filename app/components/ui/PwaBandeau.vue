<script setup lang="ts">
/**
 * Installer l'application, et la mettre à jour.
 *
 * `installPrompt: true` était configuré et `$pwa` n'était lu nulle part : le
 * navigateur gardait l'invitation à installer pour lui, et une nouvelle
 * version se chargeait au hasard du rechargement suivant. Un membre qui
 * ouvrait l'application depuis un onglet ne savait ni qu'il pouvait la mettre
 * sur son écran d'accueil, ni qu'une correction l'attendait.
 *
 * Deux bandeaux, jamais en même temps, et la mise à jour d'abord : une version
 * corrigée vaut plus qu'un raccourci. Le refus d'installer est retenu trente
 * jours dans `localStorage` — un confort par appareil, rien de plus.
 */
const { $pwa } = useNuxtApp()

const CLE_REFUS = 'etontine-installation-refusee'
const REFUS_MS = 30 * 24 * 60 * 60 * 1000

const refusRecent = ref(true)

onMounted(() => {
  try {
    const depuis = Number(localStorage.getItem(CLE_REFUS) ?? 0)
    refusRecent.value = depuis > 0 && Date.now() - depuis < REFUS_MS
  }
  catch {
    refusRecent.value = false
  }
})

// `$pwa` est un objet réactif : ses références sont déjà dépliées.
const miseAJour = computed(() => $pwa?.needRefresh === true)
const installation = computed(() =>
  !miseAJour.value
  && $pwa?.showInstallPrompt === true
  && $pwa.isPWAInstalled !== true
  && !refusRecent.value,
)

async function installer() {
  await $pwa?.install()
}

function plusTard() {
  try {
    localStorage.setItem(CLE_REFUS, String(Date.now()))
  }
  catch {
    // Sans stockage, le bandeau reviendra à la prochaine visite. Acceptable.
  }
  refusRecent.value = true
  $pwa?.cancelInstall()
}

async function recharger() {
  await $pwa?.updateServiceWorker(true)
}
</script>

<template>
  <div
    v-if="miseAJour"
    role="status"
    class="flex items-center gap-3 border-b border-line bg-brand-surface px-4 py-2 text-sm text-brand-strong"
    data-testid="bandeau-mise-a-jour"
  >
    <Icon
      name="lucide:refresh-cw"
      size="1rem"
      class="shrink-0"
      aria-hidden="true"
    />
    <span class="flex-1">{{ $t('ui.PwaBandeau.une_nouvelle_version_est') }}</span>
    <button
      type="button"
      class="min-h-touch shrink-0 font-semibold underline underline-offset-4"
      data-testid="bouton-recharger"
      @click="recharger"
    >
      {{ $t('ui.PwaBandeau.recharger') }}
    </button>
  </div>

  <div
    v-else-if="installation"
    role="status"
    class="flex items-center gap-3 border-b border-line bg-surface px-4 py-2 text-sm text-ink"
    data-testid="bandeau-installation"
  >
    <Icon
      name="lucide:smartphone"
      size="1rem"
      class="shrink-0 text-brand"
      aria-hidden="true"
    />
    <span class="flex-1">{{ $t('ui.PwaBandeau.mets_etontine_sur_ton') }}</span>
    <button
      type="button"
      class="min-h-touch shrink-0 font-semibold text-brand underline underline-offset-4"
      data-testid="bouton-installer"
      @click="installer"
    >
      {{ $t('ui.PwaBandeau.installer') }}
    </button>
    <button
      type="button"
      class="min-h-touch shrink-0 text-ink-muted"
      :aria-label="$t('ui.PwaBandeau.plus_tard')"
      data-testid="bouton-plus-tard"
      @click="plusTard"
    >
      <Icon
        name="lucide:x"
        size="1rem"
        aria-hidden="true"
      />
    </button>
  </div>
</template>
