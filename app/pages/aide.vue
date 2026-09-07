<script setup lang="ts">
/**
 * Page d'aide, **mise en cache pour la consultation hors ligne**.
 *
 * C'est délibéré : quelqu'un qui ne comprend pas ce qui se passe est souvent
 * quelqu'un qui n'a pas de réseau. Une aide inaccessible au moment où elle
 * servirait n'est pas une aide.
 *
 * **Sans mise en page** : la page est publique, liée depuis la landing, et la
 * coquille authentifiée n'aurait pas de sens pour un visiteur sans compte.
 * Elle porte donc elle-même la barre d'onglets — mais seulement pour qui a une
 * session : c'est un onglet de cette barre qui mène ici, et le membre qui le
 * touche ne doit pas se retrouver dans un écran sans retour.
 *
 * La barre est rendue côté client uniquement. La page est mise en cache pour
 * le hors-ligne, et un HTML figé porterait la barre à un visiteur déconnecté.
 */
definePageMeta({ layout: false })

const session = useSessionStore()
onMounted(() => session.charger())

/**
 * Où ramène le lien de retour. Il bascule après l'hydratation, quand la session
 * est connue : avant, on ne sait rien, et l'accueil public est la bonne réponse
 * par défaut — c'est ce que voit un visiteur, et c'est ce qui est mis en cache.
 */
const retour = computed(() => session.connecte
  ? { to: '/app', label: 'Mes tontines' }
  : { to: '/', label: 'Retour à l’accueil' })

useHead({
  title: 'Aide — eTontine',
  meta: [{
    name: 'description',
    content: 'Comment fonctionne eTontine : cotiser, confirmer, verser le pot.',
  }],
})

const questions = [
  {
    q: 'L’application garde-t-elle mon argent ?',
    r: 'Non, jamais. Tu envoies directement sur le numéro de collecte de '
      + 'l’organisateur, avec ton application de paiement habituelle. '
      + 'L’application sert à déclarer ton envoi et à tenir le registre du groupe.',
  },
  {
    q: 'Quelle différence entre « déclaré » et « confirmé » ?',
    r: 'Déclaré veut dire que tu as annoncé ton envoi. Confirmé veut dire que '
      + 'le trésorier l’a retrouvé sur son compte. Tant que ce n’est pas '
      + 'confirmé, ta cotisation n’est pas comptée dans le pot.',
  },
  {
    q: 'J’ai deux parts. Pourquoi deux cotisations ?',
    r: 'Une part, c’est une place dans la rotation. Avec deux parts, tu prends '
      + 'la main deux fois sur le cycle, et tu cotises donc deux fois par tour.',
  },
  {
    q: 'Je n’ai pas de réseau. Ma déclaration est-elle perdue ?',
    r: 'Non. Elle est gardée sur ton téléphone et partira toute seule dès que '
      + 'le réseau revient. Tu n’as rien à refaire, et elle ne partira pas en double.',
  },
  {
    q: 'Comment savoir que j’envoie au bon numéro ?',
    r: 'L’écran « où envoyer » affiche toujours le nom du titulaire du compte. '
      + 'Vérifie que ce nom s’affiche bien dans ton application de paiement '
      + 'avant de valider. Si le numéro a changé récemment, un avertissement '
      + 'apparaît : appelle le bureau avant d’envoyer.',
  },
  {
    q: 'Le registre peut-il être modifié après coup ?',
    r: 'Non. Chaque écriture est liée à la précédente par une empreinte : '
      + 'modifier ou supprimer une ligne casse la chaîne, et le contrôle du '
      + 'registre le signale. N’importe quel membre peut lancer ce contrôle.',
  },
  {
    q: 'Une erreur a été enregistrée. Que faire ?',
    r: 'Rien ne s’efface au registre. Ouvre une contestation depuis l’écriture '
      + 'concernée : le bureau doit y répondre, et la correction s’ajoute à '
      + 'côté. La trace de l’erreur reste visible de tous.',
  },
]
</script>

<template>
  <div class="min-h-dvh">
    <!-- Le bandeau hors-ligne, comme dans la mise en page de l'application.
         C'est ici qu'il manque le plus : cette page est justement celle qu'on
         atteint sans réseau, et une saisie enfilée ailleurs continue de partir
         toute seule pendant qu'on la lit. Il ne dépend pas de la session — une
         coupure réseau n'a rien à voir avec le fait d'avoir un compte. -->
    <OfflineBanner />

    <!-- Même bandeau en dégradé que la landing et que l'application : une page
         d'aide qui ne ressemble pas au produit donne l'impression d'avoir
         quitté le produit. -->
    <header class="gradient-trust rounded-b-tile px-6 pt-6 pb-10 text-night-ink">
      <div class="mx-auto max-w-2xl">
        <!-- L'accueil d'un membre n'est pas celui d'un visiteur : renvoyer un
             membre sur la page de présentation du produit, alors que la barre
             juste en dessous porte un onglet « Accueil » vers son tableau de
             bord, donne deux accueils contradictoires sur le même écran. -->
        <NuxtLink
          :to="retour.to"
          class="min-h-touch inline-flex items-center gap-1 text-xs font-semibold text-night-ink/75 hover:text-night-ink"
          data-testid="aide-retour"
        >
          <Icon
            name="lucide:arrow-left"
            size="0.875rem"
            aria-hidden="true"
          />
          {{ retour.label }}
        </NuxtLink>
        <h1 class="mt-2 text-2xl font-bold">
          Aide
        </h1>
        <p class="mt-1 text-night-ink/75">
          Les questions qui reviennent le plus souvent.
        </p>
      </div>
    </header>

    <!-- La marge basse laisse passer la barre d'onglets quand elle est là :
         sans elle, le dernier lien se retrouve dessous, inatteignable. -->
    <main
      class="mx-auto flex max-w-2xl flex-col gap-6 px-6 pt-8"
      :class="session.connecte ? 'pb-28' : 'pb-8'"
    >
      <dl class="flex flex-col gap-4">
        <div
          v-for="(item, i) in questions"
          :key="i"
          class="card-surface flex flex-col gap-2 p-5"
        >
          <dt class="font-semibold text-ink">
            {{ item.q }}
          </dt>
          <dd class="text-base leading-relaxed text-ink-muted">
            {{ item.r }}
          </dd>
        </div>
      </dl>

      <NuxtLink
        :to="retour.to"
        class="min-h-touch inline-flex items-center gap-2 text-sm text-brand underline underline-offset-4"
      >
        {{ retour.label }}
      </NuxtLink>
    </main>

    <ClientOnly>
      <BarreOnglets v-if="session.connecte" />
    </ClientOnly>
  </div>
</template>

<!--
  États d'écran (règle 14) :
  · chargement — sans objet : contenu statique, mis en cache pour le hors-ligne
  · vide       — sans objet : la liste de questions est fixe
  · erreur     — sans objet : aucun appel réseau
  · hors-ligne — la page est mise en cache pour être lue sans réseau, et le
                 bandeau `OfflineBanner` annonce la coupure
  · contenu    — les questions fréquentes
-->
