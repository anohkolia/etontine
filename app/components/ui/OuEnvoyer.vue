<script setup lang="ts">
/**
 * Écran « où envoyer » (T14).
 *
 * Trois éléments décident du succès de l'envoi, et tous les trois sont
 * toujours visibles :
 *
 * 1. **Le nom du titulaire.** C'est la protection anti-arnaque n°1 : le membre
 *    le compare à ce que son application de paiement lui affiche avant de
 *    valider. Un numéro seul ne prouve rien ; un nom qui ne correspond pas
 *    arrête le geste.
 * 2. **Le numéro, en gros, avec un bouton Copier.** Recopier dix chiffres à la
 *    main sur un petit écran est la première source d'envoi au mauvais compte.
 * 3. **La référence courte**, à mettre en commentaire du paiement : sur un pot
 *    où tout le monde envoie la même somme le même jour, c'est le seul moyen
 *    pour le trésorier de savoir qui a payé quoi.
 *
 * **Aucun frais n'est affiché.** Le membre les supporte de toute façon, à
 * l'envoi comme au retrait, et il en connaît l'ordre de grandeur. Une
 * estimation de plus n'ajouterait qu'un chiffre approximatif sur l'écran où la
 * charge mentale doit être la plus basse — et si l'estimation était fausse, il
 * enverrait le mauvais montant.
 */
import type { paymentChannel } from '#shared/schemas'
import type { z } from 'zod'
import { channelPresentation, PAYMENT_CHANNEL } from '#shared/constants/statuts'

const CANAUX_CONNUS = new Set(Object.keys(PAYMENT_CHANNEL))

interface Canal {
  id: string
  provider: string
  msisdn: string
  holderName: string
  paymentLinkUrl: string | null
  frozenUntil: string | null
}

const props = defineProps<{
  expectedAmount: number
  reference: string
  channels: Canal[]
}>()

const { copie, copier } = useCopie()
const { copie: copieRef, copier: copierRef } = useCopie()

const canalChoisi = ref(props.channels[0]?.id ?? '')
const canal = computed(() => props.channels.find(c => c.id === canalChoisi.value) ?? props.channels[0])

/**
 * Le nom de l'opérateur vient de la table partagée des canaux, et non d'une
 * seconde liste tenue ici : `<CanalPill>`, le registre et cet écran doivent
 * écrire « Orange Money » exactement pareil.
 */
function nomOperateur(provider: string): string {
  const canal = asCanal(provider)
  return canal ? channelPresentation(canal).label : provider
}

/**
 * Restreint un `provider` (chaîne libre venue du serveur) au type du canal.
 * Le transtypage vit ici plutôt que dans le gabarit : une assertion de type
 * dans un `<template>` exige que le schéma Zod soit importé comme *valeur*,
 * ce qui embarquerait Zod dans le lot client pour une simple étiquette.
 */
function asCanal(provider: string): z.infer<typeof paymentChannel> | null {
  return CANAUX_CONNUS.has(provider) ? provider as z.infer<typeof paymentChannel> : null
}

/** Un canal changé il y a moins de 48 h est gelé : on le dit franchement. */
const gele = computed(() => {
  const jusqua = canal.value?.frozenUntil
  return jusqua ? new Date(jusqua) > new Date() : false
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- Sélecteur, seulement s'il y a un choix à faire. -->
    <fieldset
      v-if="channels.length > 1"
      class="flex flex-col gap-2"
      data-testid="selecteur-canal"
    >
      <legend class="pb-1 text-sm font-medium text-ink-muted">
        Par quel service envoies-tu ?
      </legend>
      <!-- Cartes sélectionnables plutôt que boutons radio nus, repris de
           l'écran de paiement du template : la zone cliquable fait toute la
           carte, et le titulaire s'affiche dès le choix — c'est lui que le
           membre doit reconnaître. Le bouton radio reste dans le balisage,
           masqué visuellement : il porte le clavier et le lecteur d'écran. -->
      <label
        v-for="c in channels"
        :key="c.id"
        class="card-surface flex min-h-touch cursor-pointer items-center gap-3 p-3 transition-shadow"
        :class="canalChoisi === c.id ? 'ring-2 ring-brand' : 'hover:shadow-float'"
      >
        <input
          v-model="canalChoisi"
          type="radio"
          :value="c.id"
          class="peer sr-only"
          :data-testid="`choix-canal-${c.provider}`"
        >
        <CanalPill
          v-if="asCanal(c.provider)"
          :canal="asCanal(c.provider)!"
          compact
        />
        <span class="min-w-0 flex-1 truncate text-sm text-ink-muted">
          {{ c.holderName }}
        </span>
        <span
          class="size-5 shrink-0 rounded-full border-2 transition-colors"
          :class="canalChoisi === c.id ? 'border-brand bg-brand' : 'border-line-strong'"
          aria-hidden="true"
        />
      </label>
    </fieldset>

    <template v-if="canal">
      <!-- Montant. Rien d'autre : pas d'estimation de frais, pas de total
           approximatif. C'est ce chiffre-là que le membre doit taper. -->
      <div class="card-surface flex flex-col gap-1 p-4">
        <p class="text-sm text-ink-muted">
          Montant à envoyer
        </p>
        <AmountDisplay
          :amount="expectedAmount"
          size="xl"
          data-testid="montant-a-envoyer"
        />
      </div>

      <!-- Titulaire et numéro -->
      <div class="card-surface flex flex-col gap-3 p-4">
        <div class="flex flex-col gap-1">
          <p class="text-sm text-ink-muted">
            Au nom de
          </p>
          <!-- Toujours affiché. C'est ce que le membre vérifie dans son
               application de paiement avant de valider. -->
          <p
            class="text-lg font-semibold text-ink"
            data-testid="nom-titulaire"
          >
            {{ canal.holderName }}
          </p>
          <p class="text-sm text-ink-subtle">
            Vérifie que ce nom s’affiche bien dans {{ nomOperateur(canal.provider) }}
            avant de valider ton envoi.
          </p>
        </div>

        <div class="flex flex-col gap-2">
          <p class="text-sm text-ink-muted">
            Numéro
          </p>
          <p
            class="font-mono text-2xl font-bold tracking-wider tabular-nums text-ink"
            data-testid="numero-collecte"
          >
            {{ canal.msisdn }}
          </p>
          <button
            type="button"
            class="min-h-touch inline-flex items-center justify-center gap-2 rounded-control border border-line-strong bg-surface px-5 font-semibold text-ink"
            data-testid="bouton-copier-numero"
            @click="copier(canal.msisdn)"
          >
            <Icon
              :name="copie ? 'lucide:check' : 'lucide:copy'"
              size="1rem"
              aria-hidden="true"
            />
            {{ copie ? 'Numéro copié' : 'Copier le numéro' }}
          </button>
        </div>

        <p
          v-if="gele"
          class="flex items-start gap-2 rounded-control bg-late-surface p-3 text-sm text-late-ink"
          role="status"
          data-testid="canal-gele"
        >
          <Icon
            name="lucide:triangle-alert"
            size="1rem"
            class="mt-0.5 shrink-0"
            aria-hidden="true"
          />
          Ce numéro de collecte a changé récemment. Vérifie auprès du bureau
          avant d’envoyer.
        </p>
      </div>

      <!-- Référence -->
      <div class="card-surface flex flex-col gap-2 p-4">
        <p class="text-sm text-ink-muted">
          Référence à mettre en commentaire
        </p>
        <p
          class="font-mono text-xl font-bold tracking-wider text-ink"
          data-testid="reference-courte"
        >
          {{ reference }}
        </p>
        <p class="text-sm text-ink-subtle">
          Elle permet au trésorier de reconnaître ton envoi parmi les autres.
        </p>
        <button
          type="button"
          class="min-h-touch inline-flex items-center justify-center gap-2 rounded-control border border-line-strong bg-surface px-5 font-semibold text-ink"
          data-testid="bouton-copier-reference"
          @click="copierRef(reference)"
        >
          <Icon
            :name="copieRef ? 'lucide:check' : 'lucide:copy'"
            size="1rem"
            aria-hidden="true"
          />
          {{ copieRef ? 'Référence copiée' : 'Copier la référence' }}
        </button>
      </div>

      <a
        v-if="canal.paymentLinkUrl"
        :href="canal.paymentLinkUrl"
        target="_blank"
        rel="noopener"
        class="min-h-touch inline-flex items-center justify-center gap-2 rounded-control bg-brand px-5 font-semibold text-brand-ink"
        data-testid="bouton-ouvrir-operateur"
      >
        <Icon
          name="lucide:external-link"
          size="1rem"
          aria-hidden="true"
        />
        Ouvrir {{ nomOperateur(canal.provider) }}
      </a>
    </template>
  </div>
</template>
