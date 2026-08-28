<template>
  <NuxtRouteAnnouncer />
  <!-- Sans <NuxtLayout>, `definePageMeta({ layout: 'app' })` reste sans effet :
       les pages s'affichent, mais sans l'en-tête ni le bandeau hors-ligne, et
       rien ne le signale à part un avertissement en console. -->
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
