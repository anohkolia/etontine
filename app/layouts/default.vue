<script setup lang="ts">
/**
 * Mise en page neutre.
 *
 * La landing et l'écran de connexion portent leur propre structure ;
 * l'application authentifiée utilise `layouts/app.vue`. Ce fichier existe pour
 * que `<NuxtLayout>` ait toujours quelque chose à rendre.
 */
</script>

<template>
  <div>
    <slot />
  </div>
</template>
