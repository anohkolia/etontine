<script setup lang="ts">
/**
 * L'état hors-ligne des cinq états obligatoires (règle 14).
 *
 * Le bandeau ne se contente pas de signaler la coupure : il dit ce qui se
 * passe pour le membre. Sans cette phrase, le membre renvoie son paiement une
 * seconde fois.
 *
 * Encore faut-il qu'elle soit vraie sur l'écran où on la lit. Trois cas, décrits
 * par `NatureHorsLigne` :
 *
 * - `saisie` — la file de mutations couvre l'écran (T24) : une déclaration
 *   faite sans réseau part toute seule au retour. C'est la promesse forte, et
 *   elle n'engage que les écrans qui passent par `envoyerOuEnfiler` ;
 * - `lecture` — il n'y a rien à saisir. Promettre de garder une saisie sur une
 *   page d'aide ou un reçu ne veut rien dire ;
 * - `reseau-requis` — il y a un formulaire, mais rien n'est mis en file. Un
 *   code par SMS ne se demande pas hors réseau, et une invitation ne s'accepte
 *   pas non plus. Annoncer le contraire est pire que se taire : le membre
 *   attend un envoi qui n'a jamais eu lieu.
 *
 * Deux façons de le dire, selon qui rend le bandeau. Une page qui le pose
 * elle-même passe la propriété. Sous `layouts/app.vue`, c'est le gabarit qui le
 * rend et la page déclare sa nature par `useNatureHorsLigne()`.
 *
 * Ni couleur seule (règle 10), ni montant (règle 21).
 */
import type { NatureHorsLigne } from '../../composables/useNatureHorsLigne'

const { t } = useI18n()

const { nature } = defineProps<{ nature?: NatureHorsLigne }>()

const declaree = useNatureHorsLigne()
const consigne = computed(() => ({
  'saisie': t('ui.OfflineBanner.ce_que_tu_saisis'),
  'lecture': t('ui.OfflineBanner.cette_page_reste_lisible'),
  'reseau-requis': t('ui.OfflineBanner.cette_etape_a_besoin'),
}[nature ?? declaree.value]))

const online = useOnline()
const { enAttente, vider, rafraichir } = useFileHorsLigne()

/**
 * Au retour du réseau, la file part toute seule.
 *
 * Le membre n'a rien à faire, et surtout rien à refaire : c'est la promesse du
 * mode hors-ligne. Un bouton « synchroniser » reporterait sur lui une charge
 * qui revient à l'application.
 */
watch(online, async (connecte) => {
  if (connecte) await vider()
})

onMounted(async () => {
  await rafraichir()
  if (online.value) await vider()
})
</script>

<template>
  <div class="contents">
    <Transition
      enter-active-class="transition-[opacity,transform] duration-200"
      enter-from-class="-translate-y-full opacity-0"
      leave-active-class="transition-[opacity,transform] duration-200"
      leave-to-class="-translate-y-full opacity-0"
    >
      <div
        v-if="!online"
        class="flex items-center gap-2 bg-late-surface px-4 py-2 text-sm text-late-ink"
        role="status"
        data-testid="offline-banner"
      >
        <Icon
          name="lucide:wifi-off"
          size="1rem"
          class="shrink-0"
          aria-hidden="true"
        />
        <p>
          <strong class="font-semibold">{{ $t('ui.OfflineBanner.hors_ligne') }}</strong>
          {{ consigne }}
          <span
            v-if="enAttente.length > 0"
            data-testid="file-en-attente"
          >
            {{ $t('ui.OfflineBanner.p0_envoi_s_en', { p0: enAttente.length }) }}
          </span>
        </p>
      </div>
    </Transition>

    <!-- Reste visible une fois le réseau revenu, tant que la file n'est pas
       vidée : c'est le moment où le membre doute le plus. -->
    <div
      v-if="online && enAttente.length > 0"
      class="flex items-center gap-2 bg-declared-surface px-4 py-2 text-sm text-declared-ink"
      role="status"
      data-testid="bandeau-synchronisation"
    >
      <Icon
        name="lucide:refresh-cw"
        size="1rem"
        class="shrink-0 animate-spin"
        aria-hidden="true"
      />
      <p>{{ $t('ui.OfflineBanner.envoi_de_p0_saisie', { p0: enAttente.length }) }}</p>
    </div>
  </div>
</template>
