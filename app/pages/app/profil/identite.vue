<script setup lang="ts">
/**
 * Vérification d'identité — palier KYC 2.
 *
 * Exigé pour publier une tontine, et pour choisir l'accès « ouvert ». La revue
 * manuelle des pièces relève d'un back-office hors périmètre MVP : hors
 * production, le dossier est approuvé immédiatement, ce que l'écran annonce
 * sans détour plutôt que de laisser croire à un contrôle qui n'existe pas.
 */
definePageMeta({ layout: 'app', middleware: 'auth' })

const session = useSessionStore()
const route = useRoute()

const piece = ref('')
const selfie = ref('')
const envoi = ref(false)
const resultat = ref<string | null>(null)
const erreur = ref<string | null>(null)

const dejaVerifie = computed(() => (session.user?.kycLevel ?? 0) >= 2)

async function envoyer() {
  erreur.value = null
  envoi.value = true
  try {
    const reponse = await $fetch<{ status: string }>('/api/v1/me/kyc', {
      method: 'POST',
      body: { documentUrl: piece.value, selfieUrl: selfie.value },
    })
    await session.charger(true)

    resultat.value = reponse.status === 'approved'
      ? 'Identité vérifiée.'
      : 'Dossier reçu. Il sera examiné avant validation.'

    const redirection = route.query.redirect
    if (reponse.status === 'approved' && typeof redirection === 'string' && redirection.startsWith('/')) {
      await navigateTo(redirection)
    }
  }
  catch (e) {
    erreur.value = (e as { data?: { error?: { message?: string } } })?.data?.error?.message
      ?? 'Impossible de joindre le serveur.'
  }
  finally {
    envoi.value = false
  }
}

useHead({ title: 'Vérifier mon identité — Tontine CI' })
</script>

<template>
  <div class="flex flex-col gap-5">
    <h1 class="text-xl font-bold text-ink">
      Vérifier mon identité
    </h1>

    <p class="text-sm text-ink-muted">
      Une pièce d’identité et un selfie. C’est ce qui permet de publier une
      tontine : les membres doivent savoir à qui ils confient leur argent.
    </p>

    <StatusBadge
      v-if="dejaVerifie"
      kind="membership"
      status="active"
      data-testid="identite-verifiee"
    />

    <form
      v-else
      class="flex flex-col gap-3"
      @submit.prevent="envoyer"
    >
      <label
        class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
        for="piece"
      >
        Lien vers ma pièce d’identité
        <InputText
          id="piece"
          v-model="piece"
          placeholder="https://…"
          data-testid="champ-piece"
        />
      </label>
      <label
        class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
        for="selfie"
      >
        Lien vers mon selfie
        <InputText
          id="selfie"
          v-model="selfie"
          placeholder="https://…"
          data-testid="champ-selfie"
        />
      </label>

      <p
        v-if="erreur"
        role="alert"
        class="rounded-control bg-disputed-surface p-3 text-sm text-disputed-ink"
      >
        {{ erreur }}
      </p>
      <p
        v-if="resultat"
        role="status"
        class="rounded-control bg-confirmed-surface p-3 text-sm text-confirmed-ink"
        data-testid="resultat-identite"
      >
        {{ resultat }}
      </p>

      <Button
        type="submit"
        :label="envoi ? 'Envoi…' : 'Envoyer mon dossier'"
        :disabled="envoi || !piece || !selfie"
        class="bg-brand text-brand-ink hover:bg-brand-strong"
        data-testid="bouton-envoyer-identite"
      />
    </form>
  </div>
</template>

<!--
  États d'écran (règle 14) :
  · chargement — indiqué dans le libellé du bouton (« Envoi… »)
  · vide       — sans objet : le formulaire est toujours présent
  · erreur     — message en ligne avec `role="alert"`
  · hors-ligne — bandeau porté par `layouts/app.vue`
  · contenu    — le formulaire, ou le badge « vérifié »
-->
