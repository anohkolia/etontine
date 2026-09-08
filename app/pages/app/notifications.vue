<script setup lang="ts">
/**
 * Mes notifications.
 *
 * Elles s'écrivaient depuis le premier jour et n'étaient lisibles nulle part :
 * la table était en écriture seule du point de vue de l'application. Le push
 * porte la bannière jusqu'au système quand il est configuré, mais une bannière
 * ratée était perdue pour de bon — et plusieurs d'entre elles disent « ouvre
 * l'application pour voir », ce qui n'était pas tenable.
 *
 * Aucun montant n'y figure : la règle 21 est appliquée à l'écriture, dans
 * `server/services/notifications.ts`. Cet écran affiche ce que le serveur a
 * accepté d'écrire, il n'a rien à filtrer.
 */
definePageMeta({ layout: 'app', middleware: 'auth' })

const { formatDate } = useDate()
const { rafraichirCompteur } = useNotifications()

interface Notification {
  id: string
  type: string
  title: string
  body: string
  url: string | null
  readAt: string | null
  createdAt: string
}

const etat = ref<'chargement' | 'contenu' | 'vide' | 'erreur' | 'hors-ligne'>('chargement')
const items = ref<Notification[]>([])
const suite = ref<string | null>(null)
const erreur = ref<string | null>(null)
const chargeSuite = ref(false)

async function charger() {
  etat.value = 'chargement'
  try {
    const reponse = await $fetch<{ items: Notification[], nextCursor: string | null }>(
      '/api/v1/me/notifications',
    )
    items.value = reponse.items
    suite.value = reponse.nextCursor
    etat.value = reponse.items.length === 0 ? 'vide' : 'contenu'

    // Ouvrir l'écran, c'est avoir vu. On marque après avoir affiché, pour que
    // les non-lues restent distinguables sur la page qu'on est en train de lire.
    if (reponse.items.some(n => !n.readAt)) {
      await $fetch('/api/v1/me/notifications/read', { method: 'POST', body: {} })
      await rafraichirCompteur()
    }
  }
  catch (e) {
    if (!navigator.onLine) {
      etat.value = 'hors-ligne'
      return
    }
    erreur.value = (e as { data?: { error?: { message?: string } } })?.data?.error?.message
      ?? 'Impossible de joindre le serveur.'
    etat.value = 'erreur'
  }
}

async function chargerSuite() {
  if (!suite.value) return
  chargeSuite.value = true
  try {
    const reponse = await $fetch<{ items: Notification[], nextCursor: string | null }>(
      `/api/v1/me/notifications?cursor=${suite.value}`,
    )
    items.value = [...items.value, ...reponse.items]
    suite.value = reponse.nextCursor
  }
  catch {
    erreur.value = 'Impossible de charger la suite.'
  }
  finally {
    chargeSuite.value = false
  }
}

onMounted(charger)
useEnTete(() => ({
  titre: 'Notifications',
  retour: { to: '/app', label: 'Mes tontines' },
}))
useHead({ title: 'Notifications — eTontine' })
</script>

<template>
  <div class="flex flex-col gap-5">
    <LoadingSkeleton
      v-if="etat === 'chargement'"
      variant="list"
      :count="5"
    />

    <ErrorState
      v-else-if="etat === 'erreur'"
      :detail="erreur ?? undefined"
      @retry="charger"
    />

    <EmptyState
      v-else-if="etat === 'hors-ligne'"
      title="Pas de réseau"
      description="Tes notifications reviendront dès que la connexion sera revenue."
      icon="lucide:mail"
    />

    <EmptyState
      v-else-if="etat === 'vide'"
      title="Aucune notification"
      description="Ce qui se passe dans tes tontines apparaîtra ici : cotisations confirmées, pot versé, changement de numéro de collecte."
      icon="lucide:mail"
    />

    <template v-else>
      <ul
        class="flex flex-col gap-2"
        data-testid="liste-notifications"
      >
        <li
          v-for="notification in items"
          :key="notification.id"
          class="card-surface flex items-start gap-3 p-3"
          :data-testid="`notification-${notification.id}`"
        >
          <!-- Non lue : la pastille **et** le mot, jamais la couleur seule. -->
          <span
            class="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-control"
            :class="notification.readAt ? 'bg-surface-muted text-ink-muted' : 'bg-brand-surface text-brand-strong'"
            aria-hidden="true"
          >
            <Icon
              name="lucide:mail"
              size="1.125rem"
            />
          </span>

          <component
            :is="notification.url ? 'NuxtLink' : 'div'"
            :to="notification.url ?? undefined"
            class="flex min-w-0 flex-1 flex-col gap-1"
          >
            <span class="font-semibold text-ink">
              {{ notification.title }}
              <span
                v-if="!notification.readAt"
                class="text-xs font-semibold text-brand-strong"
              >· nouveau</span>
            </span>
            <span class="text-sm text-ink-muted">{{ notification.body }}</span>
            <span class="tabular text-sm text-ink-subtle">
              {{ formatDate(notification.createdAt) }}
            </span>
          </component>
        </li>
      </ul>

      <Button
        v-if="suite"
        :label="chargeSuite ? 'Chargement…' : 'Voir les plus anciennes'"
        :disabled="chargeSuite"
        class="border border-line-strong bg-surface text-ink hover:bg-surface-muted"
        data-testid="bouton-notifications-suite"
        @click="chargerSuite"
      />
    </template>
  </div>
</template>

<!--
  États d'écran (règle 14) :
  · chargement — LoadingSkeleton
  · vide       — EmptyState, avec ce qui apparaîtra ici plus tard
  · erreur     — ErrorState avec reprise
  · hors-ligne — état distinct : rien n'est perdu, tout revient au réseau
  · contenu    — la liste, non lues distinguées par la pastille et le mot
-->
