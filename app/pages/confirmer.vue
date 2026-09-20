<script setup lang="ts">
/**
 * Arrivée par le lien reçu par e-mail : inscription ou changement d'adresse.
 *
 * Le jeton est envoyé au serveur dès l'ouverture, une seule fois. Il ouvre la
 * session dans la foulée — le lien prouve la boîte mail, le code vient d'être
 * choisi — et l'on file dans l'application. Un lien mort le dit, avec la
 * porte de sortie.
 */
definePageMeta({ layout: false })
const { t } = useI18n()

const route = useRoute()
const etat = ref<'verification' | 'invalide'>('verification')
const erreur = ref<string | null>(null)

/** Où aller une fois confirmé : un nouveau compte complète son profil, les autres retrouvent l'application. */
function destination(nouveauCompte: boolean): string {
  const demandee = route.query.redirect
  if (typeof demandee === 'string' && /^\/(?!\/)/.test(demandee)) return demandee
  return nouveauCompte ? '/app/profil' : '/app'
}

onMounted(async () => {
  const token = route.query.token
  if (typeof token !== 'string' || token.length === 0) {
    etat.value = 'invalide'
    return
  }
  try {
    const { isNewUser } = await $fetch<{ isNewUser: boolean }>('/api/v1/auth/confirm', { method: 'POST', body: { token } })
    await useSessionStore().charger(true)
    useVerrou().deverrouiller()
    await navigateTo(destination(isNewUser), { replace: true })
  }
  catch (e) {
    erreur.value = (e as { data?: { error?: { message?: string } } })?.data?.error?.message ?? null
    etat.value = 'invalide'
  }
})

useHead({ title: t('public.confirmer.confirmation_etontine') })
</script>

<template>
  <div class="flex min-h-dvh flex-col bg-surface">
    <OfflineBanner nature="reseau-requis" />

    <main class="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-6 py-8">
      <p
        v-if="etat === 'verification'"
        role="status"
        class="text-center text-ink-muted"
        data-testid="confirmation-en-cours"
      >
        {{ $t('public.confirmer.verification_en_cours') }}
      </p>

      <section
        v-else
        class="flex flex-col items-center gap-4 text-center"
        data-testid="lien-invalide"
      >
        <span
          class="flex size-14 items-center justify-center rounded-full bg-disputed-surface text-disputed-ink"
          aria-hidden="true"
        >
          <Icon
            name="lucide:link-2-off"
            size="1.5rem"
          />
        </span>
        <h1 class="text-2xl font-bold text-ink">
          {{ $t('public.confirmer.lien_invalide') }}
        </h1>
        <p class="text-ink-muted">
          {{ erreur ?? $t('public.confirmer.il_a_peut_etre_expire') }}
        </p>
        <NuxtLink
          to="/login"
          class="min-h-touch inline-flex w-full items-center justify-center rounded-control bg-brand text-sm font-semibold text-brand-ink hover:bg-brand-strong"
          data-testid="lien-connexion"
        >
          {{ $t('public.confirmer.aller_a_la_connexion') }}
        </NuxtLink>
      </section>
    </main>
  </div>
</template>

<!--
  États d'écran (règle 14) :
  · chargement — « Vérification du lien… »
  · vide       — sans objet
  · erreur     — le lien n'est plus valable, avec la porte de sortie
  · hors-ligne — <OfflineBanner> en tête : le lien se vérifie côté serveur
  · contenu    — aucun : on file dans l'application
-->
