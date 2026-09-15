<script setup lang="ts">
/**
 * Préférences de notification, générales et **par tontine**.
 *
 * Quelqu'un qui est dans quatre tontines n'a pas la même patience pour les
 * quatre. Pouvoir couper les rappels d'une seule évite le geste qui tue : tout
 * couper d'un coup, après quoi on ne peut plus le joindre pour ce qui compte.
 *
 * La plage de silence est un réglage sérieux et pas un confort : une
 * notification à 2 h du matin sur un téléphone partagé, c'est la famille
 * réveillée et l'application désinstallée le lendemain.
 */
definePageMeta({ layout: 'app', middleware: 'auth' })
const { t } = useI18n()

interface Reglage {
  pushEnabled: boolean
  remindersEnabled: boolean
  quietHoursStart: number | null
  quietHoursEnd: number | null
}

interface Reponse {
  general: Reglage | null
  parTontine: Array<{ tontineId: string, tontineName: string, reglage: Reglage | null }>
}

const etat = ref<'chargement' | 'contenu' | 'erreur'>('chargement')
const donnees = ref<Reponse | null>(null)
const erreur = ref<string | null>(null)

/**
 * L'abonnement du navigateur, appareil par appareil.
 *
 * Les réglages ci-dessous disent **ce qu'on veut** recevoir ; celui-ci dit si
 * cet appareil-là peut le recevoir. Les deux sont nécessaires, et le second
 * manquait entièrement : aucun navigateur ne s'était jamais abonné, donc les
 * notifications ne quittaient jamais la base.
 *
 * La permission se demande sur ce bouton, jamais à l'ouverture : une demande
 * surgie de nulle part se refuse d'un réflexe, et un refus est définitif.
 */
const { etat: etatPush, erreur: erreurPush, enCours: pushEnCours, rafraichir: rafraichirPush, activer } = usePush()

const MESSAGE_PUSH: Record<string, string> = {
  'indisponible': t('profil.notifications.ce_navigateur_ne_sait'),
  'non-configure': t('profil.notifications.les_notifications_ne_sont'),
  'refuse': t('profil.notifications.tu_as_refuse_les'),
  'inactif': t('profil.notifications.cet_appareil_ne_recoit'),
  'actif': t('profil.notifications.cet_appareil_recoit_les'),
}

const DEFAUT: Reglage = {
  pushEnabled: true, remindersEnabled: true, quietHoursStart: null, quietHoursEnd: null,
}

/** `1260` → `21:00`. Les minutes depuis minuit sont ce que stocke le serveur. */
function versHeure(minutes: number | null): string {
  if (minutes === null) return ''
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

function versMinutes(heure: string): number | null {
  if (!heure) return null
  const [h, m] = heure.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

async function charger() {
  etat.value = 'chargement'
  try {
    donnees.value = await $fetch<Reponse>('/api/v1/me/notification-preferences')
    etat.value = 'contenu'
  }
  catch (e) {
    erreur.value = (e as { data?: { error?: { message?: string } } })?.data?.error?.message
      ?? t('commun.serveur_injoignable')
    etat.value = 'erreur'
  }
}

async function enregistrer(tontineId: string | null, modifications: Partial<Reglage>) {
  await $fetch('/api/v1/me/notification-preferences', {
    method: 'PATCH',
    body: { tontineId, ...modifications },
  })
  await charger()
}

onMounted(async () => {
  await charger()
  await rafraichirPush()
})
useEnTete(() => ({
  titre: t('profil.notifications.notifications'),
  sousTitre: t('profil.notifications.ce_que_tu_recois'),
  retour: { to: '/app/profil', label: t('commun.mon_profil') },
}))
useHead({ title: t('profil.notifications.notifications_etontine') })
</script>

<template>
  <div class="flex flex-col gap-5">
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

    <template v-else-if="donnees">
      <!-- Cet appareil -->
      <section
        class="flex flex-col gap-3 card-surface p-4"
        data-testid="section-push"
      >
        <h2 class="font-semibold text-ink">
          {{ $t('profil.notifications.sur_cet_appareil') }}
        </h2>

        <p
          class="flex items-start gap-2 text-sm text-ink-muted"
          data-testid="etat-push"
        >
          <Icon
            :name="etatPush === 'actif' ? 'lucide:circle-check' : 'lucide:mail'"
            size="1rem"
            class="mt-0.5 shrink-0"
            aria-hidden="true"
          />
          {{ MESSAGE_PUSH[etatPush] }}
        </p>

        <Button
          v-if="etatPush === 'inactif'"
          :label="pushEnCours ? $t('profil.notifications.activation') : $t('profil.notifications.activer_sur_cet_appareil')"
          :disabled="pushEnCours"
          class="bg-brand text-brand-ink hover:bg-brand-strong"
          data-testid="bouton-activer-push"
          @click="activer"
        />

        <p
          v-if="erreurPush"
          role="alert"
          class="rounded-control bg-disputed-surface p-3 text-sm text-disputed-ink"
        >
          {{ erreurPush }}
        </p>
      </section>

      <!-- Réglages généraux -->
      <section class="flex flex-col gap-3 card-surface p-4">
        <h2 class="font-semibold text-ink">
          {{ $t('profil.notifications.pour_toutes_mes_tontines') }}
        </h2>

        <label class="flex min-h-touch items-start gap-3 text-sm">
          <input
            type="checkbox"
            class="mt-1 size-5 shrink-0 accent-brand"
            :checked="(donnees.general ?? DEFAUT).remindersEnabled"
            data-testid="bascule-rappels"
            @change="enregistrer(null, { remindersEnabled: ($event.target as HTMLInputElement).checked })"
          >
          <span>
            <span class="font-medium text-ink">{{ $t('profil.notifications.rappels_de_cotisation') }}</span>
            <span class="block text-ink-muted">
              {{ $t('profil.notifications.deux_rappels_par_tour') }}
            </span>
          </span>
        </label>

        <fieldset class="flex flex-col gap-2 border-t border-line pt-3">
          <legend class="pb-1 text-sm font-medium text-ink-muted">
            {{ $t('profil.notifications.ne_pas_me_deranger') }}
          </legend>
          <p class="text-sm text-ink-subtle">
            {{ $t('profil.notifications.aucune_notification_pendant_cette') }}
          </p>

          <div class="flex flex-wrap items-center gap-3">
            <label
              class="flex flex-col gap-1.5 text-sm text-ink-muted"
              for="silence-debut"
            >
              {{ $t('profil.notifications.de') }}
              <input
                id="silence-debut"
                type="time"
                class="min-h-touch rounded-control border border-line-strong bg-surface px-3 text-base text-ink"
                :value="versHeure((donnees.general ?? DEFAUT).quietHoursStart)"
                data-testid="champ-silence-debut"
                @change="enregistrer(null, { quietHoursStart: versMinutes(($event.target as HTMLInputElement).value) })"
              >
            </label>
            <label
              class="flex flex-col gap-1.5 text-sm text-ink-muted"
              for="silence-fin"
            >
              À
              <input
                id="silence-fin"
                type="time"
                class="min-h-touch rounded-control border border-line-strong bg-surface px-3 text-base text-ink"
                :value="versHeure((donnees.general ?? DEFAUT).quietHoursEnd)"
                data-testid="champ-silence-fin"
                @change="enregistrer(null, { quietHoursEnd: versMinutes(($event.target as HTMLInputElement).value) })"
              >
            </label>
          </div>
        </fieldset>
      </section>

      <!-- Par tontine -->
      <section
        v-if="donnees.parTontine.length > 0"
        class="flex flex-col gap-3"
      >
        <h2 class="font-semibold text-ink">
          {{ $t('profil.notifications.par_tontine') }}
        </h2>
        <p class="text-sm text-ink-muted">
          {{ $t('profil.notifications.un_reglage_propre_a') }}
        </p>

        <ul class="flex flex-col gap-2">
          <li
            v-for="entree in donnees.parTontine"
            :key="entree.tontineId"
            class="flex items-center justify-between gap-3 card-surface p-3"
            :data-testid="`prefs-${entree.tontineId}`"
          >
            <span class="font-medium text-ink">{{ entree.tontineName }}</span>
            <label class="flex min-h-touch items-center gap-2 text-sm text-ink-muted">
              <input
                type="checkbox"
                class="size-5 accent-brand"
                :checked="(entree.reglage ?? donnees.general ?? DEFAUT).remindersEnabled"
                :data-testid="`bascule-${entree.tontineId}`"
                @change="enregistrer(entree.tontineId, { remindersEnabled: ($event.target as HTMLInputElement).checked })"
              >
              {{ $t('profil.notifications.rappels') }}
            </label>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<!--
  États d'écran (règle 14) :
  · chargement — squelette de cartes
  · vide       — sans objet : les réglages généraux existent toujours
  · erreur     — ErrorState avec reprise
  · hors-ligne — bandeau porté par `layouts/app.vue`
  · contenu    — les réglages
-->
