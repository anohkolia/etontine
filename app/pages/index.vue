<script setup lang="ts">
// Landing publique, pré-rendue pour le SEO (routeRules dans nuxt.config.ts).
useHead({
  title: 'Tontine CI — la tontine, sans le carnet',
  meta: [
    {
      name: 'description',
      content:
        'Gérez votre tontine rotative : cotisations déclarées, confirmées par le trésorier, '
        + 'et un registre que tout le monde peut lire.',
    },
  ],
})
</script>

<template>
  <main class="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-6 px-6 py-16">
    <h1 class="text-3xl font-bold tracking-tight text-neutral-900">
      Tontine CI
    </h1>
    <p class="text-lg leading-relaxed text-neutral-700">
      La tontine de votre groupe, tenue au clair : chaque cotisation est déclarée,
      confirmée par le trésorier, et inscrite dans un registre que tout le monde peut lire.
    </p>
    <p class="text-sm text-neutral-500">
      Application en cours de construction.
      <NuxtLink
        to="/demo"
        class="underline underline-offset-4 hover:text-neutral-800"
      >
        Page de démonstration technique
      </NuxtLink>
    </p>
  </main>
</template>

<!--
  États d'écran (règle 14) :
  · chargement — sans objet : page pré-rendue, aucun appel réseau
  · vide       — sans objet : contenu éditorial fixe
  · erreur     — sans objet : rien ne peut échouer côté client
  · hors-ligne — sans objet : la page est servie depuis le cache du service worker
  · contenu    — la landing
-->
