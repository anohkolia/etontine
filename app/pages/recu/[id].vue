<script setup lang="ts">
/**
 * Page publique d'un reçu, ouverte par lien signé.
 *
 * Consultable **sans compte** : le reçu circule par WhatsApp, et celui qui le
 * reçoit n'est pas forcément membre. Elle n'affiche que montant, date, tontine
 * et membre — rien sur les autres membres, rien sur l'état du pot.
 */
definePageMeta({ layout: false })

const route = useRoute()
const id = route.params.id as string
const { formatDate } = useDate()

interface Recu {
  amount: number
  channel: string
  declaredAt: string
  confirmedAt: string | null
  tontineName: string
  roundIndex: number
  memberName: string
  status: 'confirmed' | 'pending' | 'rejected'
}

const requete = computed(() => ({ exp: route.query.exp, sig: route.query.sig }))
const { data: recu, error, status, refresh } = await useFetch<Recu>(`/api/v1/receipts/${id}`, {
  query: requete,
})

const urlImage = computed(() =>
  `/api/v1/receipts/${id}/image?exp=${route.query.exp}&sig=${route.query.sig}`,
)

useHead(() => ({
  title: recu.value ? `Reçu — ${recu.value.tontineName}` : 'Reçu — eTontine',
  // Un reçu ne doit pas se retrouver indexé par un moteur de recherche.
  meta: [{ name: 'robots', content: 'noindex, nofollow' }],
}))
</script>

<template>
  <div class="flex min-h-dvh flex-col bg-surface-muted">
    <OfflineBanner />

    <main class="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-5 py-8">
      <LoadingSkeleton
        v-if="status === 'pending'"
        variant="card"
        :count="1"
      />

      <!-- Lien expiré : état vide, avec la marche à suivre. Panne serveur :
           état d'erreur, avec une reprise. Confondre les deux laisserait le
           lecteur croire qu'il n'a rien à faire alors qu'un simple nouvel
           essai suffirait. -->
      <EmptyState
        v-else-if="error && error.statusCode === 404"
        title="Ce reçu n’est plus consultable"
        description="Le lien a expiré ou n’est pas valable. Demande-en un nouveau au bureau de la tontine."
        icon="lucide:receipt"
      />

      <ErrorState
        v-else-if="error"
        :detail="error.message"
        @retry="refresh()"
      />

      <template v-else-if="recu">
        <h1 class="text-sm tracking-widest text-ink-muted uppercase">
          Reçu de cotisation
        </h1>

        <div class="flex flex-col gap-4 card-surface p-5">
          <AmountDisplay
            :amount="recu.amount"
            size="xl"
            data-testid="recu-montant"
          />

          <StatusBadge
            kind="contribution"
            :status="recu.status === 'confirmed' ? 'confirmed' : (recu.status === 'rejected' ? 'disputed' : 'declared')"
            data-testid="recu-statut"
          />

          <dl class="flex flex-col gap-3 border-t border-line pt-4">
            <div class="flex items-baseline justify-between gap-3">
              <dt class="text-sm text-ink-muted">
                Tontine
              </dt>
              <dd
                class="font-medium text-ink"
                data-testid="recu-tontine"
              >
                {{ recu.tontineName }}
              </dd>
            </div>
            <div class="flex items-baseline justify-between gap-3">
              <dt class="text-sm text-ink-muted">
                Membre
              </dt>
              <dd
                class="font-medium text-ink"
                data-testid="recu-membre"
              >
                {{ recu.memberName }}
              </dd>
            </div>
            <div class="flex items-baseline justify-between gap-3">
              <dt class="text-sm text-ink-muted">
                Tour
              </dt>
              <dd class="font-medium text-ink">
                {{ recu.roundIndex }}
              </dd>
            </div>
            <div class="flex items-baseline justify-between gap-3">
              <dt class="text-sm text-ink-muted">
                Date
              </dt>
              <dd
                class="font-medium text-ink"
                data-testid="recu-date"
              >
                {{ formatDate(recu.confirmedAt ?? recu.declaredAt) }}
              </dd>
            </div>
          </dl>
        </div>

        <a
          :href="urlImage"
          target="_blank"
          rel="noopener"
          class="min-h-touch inline-flex items-center justify-center gap-2 rounded-control border border-line-strong bg-surface px-5 font-semibold text-ink"
          data-testid="lien-image-recu"
        >
          <Icon
            name="lucide:image"
            size="1rem"
            aria-hidden="true"
          />
          Voir le reçu en image
        </a>

        <p class="text-sm text-ink-subtle">
          Ce reçu ne montre que cette cotisation. Il ne dit rien des autres
          membres de la tontine.
        </p>
      </template>
    </main>
  </div>
</template>

<!--
  États d'écran (règle 14) :
  · chargement — squelette pendant la lecture du reçu
  · vide       — EmptyState quand le lien signé a expiré
  · erreur     — ErrorState avec reprise, distinct du lien expiré
  · hors-ligne — <OfflineBanner> en tête de page
  · contenu    — le reçu
-->
