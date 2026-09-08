<script setup lang="ts">
/**
 * Aperçu d'une invitation — **consultable sans être connecté**.
 *
 * C'est la porte d'entrée du produit. Quelqu'un reçoit un lien par WhatsApp :
 * il doit pouvoir juger avant de créer un compte. Exiger la connexion d'abord
 * ferait perdre la moitié des arrivants, et reviendrait à demander de
 * s'inscrire pour découvrir un engagement qu'on refusera peut-être.
 */
definePageMeta({ layout: false })

const route = useRoute()
const token = route.params.token as string
const session = useSessionStore()
const { phrase } = useEngagement()

interface Apercu {
  tontineId: string
  name: string
  description: string | null
  locality: string | null
  presidentName: string
  shareAmount: number
  frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly'
  memberCount: number
  totalShares: number
  status: string
  /** Le groupe a atteint le nombre de membres du palier de son président. */
  complet: boolean
}

const { data: apercu, error, status, refresh } = await useFetch<Apercu>(`/api/v1/invites/${token}`)

const adhesion = ref<'repos' | 'envoi' | 'faite'>('repos')

/**
 * La tontine a démarré : sa rotation est figée, elle n'accueille plus de
 * nouvel arrivant. On le dit avant le clic plutôt qu'après.
 *
 * Le bouton reste actif pour autant : quelqu'un que le bureau a déjà saisi à
 * la main vient ici confirmer son compte, et lui a toujours sa place. Le
 * serveur fait la différence, pas l'écran.
 */
const dejaDemarree = computed(() =>
  Boolean(apercu.value) && apercu.value!.status !== 'draft' && apercu.value!.status !== 'open',
)
const messageAdhesion = ref<string | null>(null)

/**
 * Le nombre de tours d'un cycle, donc la durée de l'engagement.
 *
 * Tant que la tontine n'a aucune part attribuée, on ne peut rien promettre :
 * la phrase reste vide plutôt que d'annoncer un total faux.
 */
const nombreDeTours = computed(() => apercu.value?.totalShares ?? 0)

const engagement = computed(() =>
  apercu.value
    ? phrase(apercu.value.shareAmount, nombreDeTours.value, apercu.value.frequency)
    : '',
)

async function rejoindre() {
  if (!session.connecte) {
    // On garde l'intention : après connexion, on revient exactement ici.
    return navigateTo({ path: '/login', query: { redirect: route.fullPath } })
  }

  adhesion.value = 'envoi'
  try {
    const resultat = await $fetch<{ status: string, rattache: boolean }>(
      `/api/v1/invites/${token}/accept`,
      { method: 'POST' },
    )
    adhesion.value = 'faite'
    messageAdhesion.value = resultat.status === 'active'
      ? 'Tu fais partie de cette tontine.'
      : 'Ta demande est envoyée. Le président doit l’accepter.'
  }
  catch (e) {
    adhesion.value = 'repos'
    const err = e as { data?: { error?: { code?: string, message?: string } } }
    if (err.data?.error?.code === 'KYC_REQUIRED') {
      return navigateTo({ path: '/app/profil', query: { redirect: route.fullPath, palier: '1' } })
    }
    messageAdhesion.value = err.data?.error?.message ?? 'Impossible de rejoindre pour l’instant.'
  }
}

onMounted(() => session.charger())

useHead(() => ({
  title: apercu.value ? `Rejoindre ${apercu.value.name} — eTontine` : 'Invitation — eTontine',
}))
</script>

<template>
  <div class="flex min-h-dvh flex-col bg-surface-muted">
    <!-- rejoindre une tontine passe par un appel direct, jamais par la file. -->
    <OfflineBanner nature="reseau-requis" />

    <main class="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-5 py-8">
      <LoadingSkeleton
        v-if="status === 'pending'"
        variant="card"
        :count="1"
      />

      <!-- Un lien invalide n'est pas une panne : c'est un état vide, et le
           message doit dire quoi faire. Une vraie erreur serveur, elle, mérite
           un bouton de reprise — ce sont deux situations différentes. -->
      <EmptyState
        v-else-if="error && error.statusCode === 404"
        title="Ce lien n’est plus valable"
        description="Il a peut-être expiré, ou déjà servi au maximum de fois prévu. Demande un nouveau lien à l’organisateur."
        icon="lucide:link-2-off"
      />

      <ErrorState
        v-else-if="error"
        :detail="error.message"
        @retry="refresh()"
      />

      <template v-else-if="apercu">
        <header class="flex flex-col gap-2">
          <p class="text-sm text-ink-muted">
            Tu es invité à rejoindre
          </p>
          <h1
            class="text-2xl font-bold text-ink"
            data-testid="nom-tontine"
          >
            {{ apercu.name }}
          </h1>
          <p
            v-if="apercu.locality"
            class="text-sm text-ink-muted"
          >
            {{ apercu.locality }}
          </p>
        </header>

        <!-- Ce que voit un visiteur non connecté : de quoi juger, rien de plus.
             Pas la liste des membres, pas leurs numéros. -->
        <dl class="flex flex-col gap-3 card-surface p-4">
          <div class="flex items-baseline justify-between gap-3">
            <dt class="text-sm text-ink-muted">
              Le président
            </dt>
            <dd
              class="font-medium text-ink"
              data-testid="president"
            >
              {{ apercu.presidentName }}
            </dd>
          </div>
          <div class="flex items-baseline justify-between gap-3">
            <dt class="text-sm text-ink-muted">
              Montant d’une part
            </dt>
            <dd data-testid="montant">
              <AmountDisplay
                :amount="apercu.shareAmount"
                size="lg"
              />
            </dd>
          </div>
          <div class="flex items-baseline justify-between gap-3">
            <dt class="text-sm text-ink-muted">
              Fréquence
            </dt>
            <dd
              class="font-medium text-ink"
              data-testid="frequence"
            >
              {{ {
                daily: 'Chaque jour',
                weekly: 'Chaque semaine',
                biweekly: 'Tous les quinze jours',
                monthly: 'Chaque mois',
              }[apercu.frequency] }}
            </dd>
          </div>
          <div class="flex items-baseline justify-between gap-3">
            <dt class="text-sm text-ink-muted">
              Membres
            </dt>
            <dd
              class="font-medium text-ink"
              data-testid="nb-membres"
            >
              {{ apercu.memberCount }}
            </dd>
          </div>
        </dl>

        <!-- La phrase d'engagement, générée à partir des réglages réels : c'est
             le seul endroit où l'on dit à quelqu'un ce qu'il signe. -->
        <p
          v-if="engagement"
          class="rounded-card border border-declared-ink/20 bg-declared-surface p-4 text-base text-declared-ink"
          data-testid="engagement"
        >
          {{ engagement }}
        </p>
        <p
          v-else
          class="card-surface p-4 text-sm text-ink-muted"
          data-testid="engagement-indisponible"
        >
          Les parts ne sont pas encore attribuées : le montant total de
          l’engagement sera connu au démarrage.
        </p>

        <p
          v-if="messageAdhesion"
          role="status"
          class="rounded-control bg-surface p-3 text-sm text-ink"
          data-testid="message-adhesion"
        >
          {{ messageAdhesion }}
        </p>

        <!-- Ce qui empêchera peut-être de rejoindre, dit avant le clic.
             Règle 10 : mot + icône, jamais la couleur seule. -->
        <p
          v-if="dejaDemarree || apercu.complet"
          class="flex items-start gap-2 rounded-control bg-declared-surface p-3 text-sm text-declared-ink"
          data-testid="avertissement-adhesion"
        >
          <Icon
            name="lucide:info"
            size="1rem"
            class="mt-0.5 shrink-0"
            aria-hidden="true"
          />
          <span v-if="dejaDemarree">
            Cette tontine a déjà commencé : l’ordre de passage est fixé et elle
            n’accueille plus de nouveaux membres. Si le bureau t’a déjà inscrit,
            tu peux quand même confirmer ton compte ici.
          </span>
          <span v-else>
            Le groupe est complet. Demande au président s’il peut te faire une
            place avant de continuer.
          </span>
        </p>

        <!-- Règle 13 : action primaire en bas d'écran. -->
        <div class="mt-auto pt-2">
          <!-- Le bouton reste inactif tant que l'état de la session n'est pas
               connu. Sans cela, son action bascule une fraction de seconde
               après l'affichage — et quelqu'un qui appuie au mauvais moment
               part vers l'écran de connexion alors qu'il est déjà connecté. -->
          <Button
            v-if="adhesion !== 'faite'"
            :label="!session.chargee
              ? 'Un instant…'
              : (adhesion === 'envoi'
                ? 'Envoi…'
                : (session.connecte ? 'Rejoindre cette tontine' : 'Me connecter pour rejoindre'))"
            :disabled="adhesion === 'envoi' || !session.chargee"
            class="w-full bg-brand text-brand-ink hover:bg-brand-strong"
            data-testid="bouton-rejoindre"
            @click="rejoindre"
          />
          <NuxtLink
            v-else
            to="/app"
            class="min-h-touch flex w-full items-center justify-center rounded-control bg-brand px-5 font-semibold text-brand-ink"
            data-testid="lien-application"
          >
            Aller à mes tontines
          </NuxtLink>
        </div>
      </template>
    </main>
  </div>
</template>

<!--
  États d'écran (règle 14) :
  · chargement — squelette pendant la lecture de l'aperçu
  · vide       — EmptyState quand le lien a expiré ou est épuisé
  · erreur     — ErrorState avec reprise, distinct du lien invalide
  · hors-ligne — <OfflineBanner> en tête de page
  · contenu    — l'aperçu et la phrase d'engagement
-->
