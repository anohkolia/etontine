<script setup lang="ts">
/**
 * Page d'aide, **mise en cache pour la consultation hors ligne**.
 *
 * C'est délibéré : quelqu'un qui ne comprend pas ce qui se passe est souvent
 * quelqu'un qui n'a pas de réseau. Une aide inaccessible au moment où elle
 * servirait n'est pas une aide.
 */
definePageMeta({ layout: false })

useHead({
  title: 'Aide — Tontine CI',
  meta: [{
    name: 'description',
    content: 'Comment fonctionne Tontine CI : cotiser, confirmer, verser le pot.',
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
  <div class="min-h-dvh bg-surface">
    <main class="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-10">
      <header class="flex flex-col gap-2">
        <h1 class="text-2xl font-bold text-ink">
          Aide
        </h1>
        <p class="text-ink-muted">
          Les questions qui reviennent le plus souvent.
        </p>
      </header>

      <dl class="flex flex-col gap-4">
        <div
          v-for="(item, i) in questions"
          :key="i"
          class="flex flex-col gap-2 rounded-card border border-line bg-surface p-4"
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
        to="/"
        class="min-h-touch inline-flex items-center gap-2 text-sm text-brand underline underline-offset-4"
      >
        Retour à l’accueil
      </NuxtLink>
    </main>
  </div>
</template>

<!--
  États d'écran (règle 14) :
  · chargement — sans objet : contenu statique, mis en cache pour le hors-ligne
  · vide       — sans objet : la liste de questions est fixe
  · erreur     — sans objet : aucun appel réseau
  · hors-ligne — la page est justement mise en cache pour être lue sans réseau
  · contenu    — les questions fréquentes
-->
