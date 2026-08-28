<script setup lang="ts">
/**
 * Mes données personnelles — export et suppression (loi n° 2013-450).
 *
 * La suppression refusée **liste les tours qui bloquent** (acceptation T08).
 * Un « impossible » sans explication, sur une application d'argent partagé, se
 * lit comme une séquestration : le membre doit savoir exactement ce qui le
 * retient et pouvoir agir dessus.
 */
definePageMeta({ layout: 'app', middleware: 'auth' })

interface Blocage {
  tontineId: string
  tontineName: string
  raison: string
  roundIndex?: number
}

const etat = ref<'repos' | 'confirmation' | 'envoi'>('repos')
const blocages = ref<Blocage[] | null>(null)
const erreur = ref<string | null>(null)

async function telecharger() {
  const donnees = await $fetch('/api/v1/me/export')
  // Le fichier est fabriqué côté client à partir de la réponse : rien n'est
  // stocké sur le serveur, et le membre garde la main sur son fichier.
  const blob = new Blob([JSON.stringify(donnees, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const lien = document.createElement('a')
  lien.href = url
  lien.download = 'mes-donnees-tontine.json'
  lien.click()
  URL.revokeObjectURL(url)
}

async function supprimer() {
  erreur.value = null
  blocages.value = null
  etat.value = 'envoi'
  try {
    await $fetch('/api/v1/me', { method: 'DELETE' })
    await navigateTo('/')
  }
  catch (e) {
    const data = (e as { data?: { blockers?: Blocage[], error?: { message?: string } } }).data
    blocages.value = data?.blockers ?? null
    erreur.value = data?.error?.message ?? 'Suppression impossible.'
    etat.value = 'repos'
  }
}

useHead({ title: 'Mes données — Tontine CI' })
</script>

<template>
  <div class="flex flex-col gap-6">
    <h1 class="text-xl font-bold text-ink">
      Mes données personnelles
    </h1>

    <section class="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
      <h2 class="font-semibold text-ink">
        Exporter
      </h2>
      <p class="text-sm text-ink-muted">
        Un fichier avec ton profil, tes adhésions et tes cotisations. Il ne
        contient rien sur les autres membres.
      </p>
      <Button
        label="Télécharger mes données"
        class="border border-line-strong bg-surface text-ink hover:bg-surface-muted"
        data-testid="bouton-export"
        @click="telecharger"
      />
    </section>

    <section class="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
      <h2 class="font-semibold text-ink">
        Supprimer mon compte
      </h2>
      <p class="text-sm text-ink-muted">
        Définitif. Tes tontines en cours doivent d’abord être réglées.
      </p>

      <div
        v-if="blocages && blocages.length > 0"
        class="flex flex-col gap-2 rounded-control bg-late-surface p-3 text-sm text-late-ink"
        role="alert"
        data-testid="blocages-suppression"
      >
        <p class="flex items-start gap-2 font-medium">
          <Icon
            name="lucide:triangle-alert"
            size="1rem"
            class="mt-0.5 shrink-0"
            aria-hidden="true"
          />
          Ces engagements doivent être réglés avant la suppression :
        </p>
        <ul class="flex flex-col gap-1 pl-6">
          <li
            v-for="(blocage, i) in blocages"
            :key="i"
            class="list-disc"
          >
            <span class="font-medium">{{ blocage.tontineName }}</span> —
            {{ blocage.raison }}
          </li>
        </ul>
      </div>

      <p
        v-else-if="erreur"
        role="alert"
        class="text-sm text-disputed-ink"
      >
        {{ erreur }}
      </p>

      <template v-if="etat === 'repos'">
        <Button
          label="Supprimer mon compte"
          class="border border-disputed-ink bg-surface text-disputed-ink hover:bg-disputed-surface"
          data-testid="bouton-supprimer"
          @click="etat = 'confirmation'"
        />
      </template>
      <template v-else>
        <p class="text-sm font-medium text-ink">
          Confirmer la suppression définitive de ton compte ?
        </p>
        <div class="flex flex-col gap-2 sm:flex-row">
          <Button
            label="Annuler"
            class="border border-line-strong bg-surface text-ink hover:bg-surface-muted sm:flex-1"
            @click="etat = 'repos'"
          />
          <Button
            :label="etat === 'envoi' ? 'Suppression…' : 'Oui, supprimer'"
            :disabled="etat === 'envoi'"
            class="bg-disputed-ink text-surface sm:flex-1"
            data-testid="bouton-confirmer-suppression"
            @click="supprimer"
          />
        </div>
      </template>
    </section>
  </div>
</template>

<!--
  États d'écran (règle 14) :
  · chargement — indiqué dans les libellés des boutons (« Suppression… »)
  · vide       — sans objet : les deux actions sont toujours proposées
  · erreur     — message en ligne, et la liste des blocages de suppression
  · hors-ligne — bandeau porté par `layouts/app.vue`
  · contenu    — export et suppression
-->
