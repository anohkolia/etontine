<script setup lang="ts">
/**
 * Connexion au back-office.
 *
 * Même mécanisme que côté membre — numéro et code d'accès, session par cookie
 * `httpOnly` — mais **une session distincte** : les deux applications tournent
 * sur des origines différentes, leurs cookies ne se partagent pas. Se
 * connecter à l'administration est un geste séparé, et c'est voulu.
 */
const { format, extraire, estComplet } = usePhoneMask()

const admin = useAdminSession()

const saisieNumero = ref('')
const code = ref('')
const enCours = ref(false)
const erreur = ref<string | null>(null)

const numeroAffiche = computed(() => format(saisieNumero.value))

function onSaisieNumero(evenement: Event) {
  const champ = evenement.target as HTMLInputElement
  saisieNumero.value = extraire(champ.value)
  champ.value = format(saisieNumero.value)
}

function message(e: unknown): string {
  return (e as { data?: { error?: { message?: string } } })?.data?.error?.message
    ?? 'Impossible de joindre le serveur.'
}

async function seConnecter() {
  erreur.value = null
  enCours.value = true
  try {
    await $fetch('/api/auth/login', {
      method: 'POST',
      body: { phone: saisieNumero.value, code: code.value },
    })
    await admin.charger(true)
    await navigateTo('/dossiers')
  }
  catch (e) {
    code.value = ''
    erreur.value = message(e)
  }
  finally {
    enCours.value = false
  }
}

onMounted(async () => {
  await admin.charger()
  if (admin.connecte.value) await navigateTo('/dossiers')
})

useHead({ title: 'Administration — eTontine' })
</script>

<template>
  <div class="mx-auto flex max-w-sm flex-col gap-6 py-16">
    <header class="flex flex-col gap-2">
      <h1 class="flex items-center gap-2 text-2xl font-bold text-ink">
        <Icon
          name="lucide:shield-check"
          size="1.5rem"
          class="text-brand"
          aria-hidden="true"
        />
        Administration
      </h1>
      <p class="text-ink-muted">
        Réservé aux comptes autorisés.
      </p>
    </header>

    <form
      class="flex flex-col gap-4 card-surface p-5"
      @submit.prevent="seConnecter"
    >
      <label
        class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
        for="telephone"
      >
        Numéro de téléphone
        <InputText
          id="telephone"
          :value="numeroAffiche"
          inputmode="tel"
          autocomplete="tel"
          placeholder="07 07 12 34 56"
          class="text-lg tracking-wider tabular-nums"
          data-testid="champ-telephone"
          @input="onSaisieNumero"
        />
      </label>

      <label
        class="flex flex-col gap-1.5 text-sm font-medium text-ink-muted"
        for="code"
      >
        Code d'accès
        <InputText
          id="code"
          v-model="code"
          type="password"
          inputmode="numeric"
          autocomplete="current-password"
          maxlength="4"
          class="text-center text-2xl tracking-[0.5em]"
          data-testid="champ-code"
          @input="erreur = null"
        />
      </label>

      <p
        v-if="erreur"
        role="alert"
        class="rounded-control bg-disputed-surface p-3 text-sm text-disputed-ink"
        data-testid="erreur-connexion"
      >
        {{ erreur }}
      </p>

      <Button
        type="submit"
        :label="enCours ? 'Vérification…' : 'Entrer'"
        :disabled="!estComplet(saisieNumero) || code.length !== 4 || enCours"
        class="bg-brand text-brand-ink hover:bg-brand-strong"
        data-testid="bouton-connexion"
      />
    </form>
  </div>
</template>
