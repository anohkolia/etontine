<script setup lang="ts">
/**
 * Connexion au back-office.
 *
 * Même mécanisme que côté membre — code à usage unique, session par cookie
 * `httpOnly` — mais **une session distincte** : les deux applications tournent
 * sur des origines différentes, leurs cookies ne se partagent pas. Se
 * connecter à l'administration est un geste séparé, et c'est voulu.
 */
const { format } = usePhoneMask()

const admin = useAdminSession()

const etape = ref<'numero' | 'code'>('numero')
const saisieNumero = ref('')
const code = ref('')
const enCours = ref(false)
const erreur = ref<string | null>(null)
const codeDeDeveloppement = ref<string | null>(null)

const { extraire, estComplet } = usePhoneMask()
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

async function demanderCode() {
  erreur.value = null
  enCours.value = true
  try {
    const reponse = await $fetch<{ devCode?: string }>('/api/auth/request', {
      method: 'POST',
      body: { phone: saisieNumero.value },
    })
    codeDeDeveloppement.value = reponse.devCode ?? null
    etape.value = 'code'
  }
  catch (e) {
    erreur.value = message(e)
  }
  finally {
    enCours.value = false
  }
}

async function verifier() {
  erreur.value = null
  enCours.value = true
  try {
    await $fetch('/api/auth/verify', {
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

useHead({ title: 'Administration — Tontine CI' })
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
      v-if="etape === 'numero'"
      class="flex flex-col gap-4 rounded-card border border-line bg-surface p-5"
      @submit.prevent="demanderCode"
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
        :label="enCours ? 'Envoi…' : 'Recevoir le code'"
        :disabled="!estComplet(saisieNumero) || enCours"
        class="bg-brand text-brand-ink hover:bg-brand-strong"
        data-testid="bouton-recevoir-code"
      />
    </form>

    <form
      v-else
      class="flex flex-col gap-4 rounded-card border border-line bg-surface p-5"
      @submit.prevent="verifier"
    >
      <p class="text-sm text-ink-muted">
        Code envoyé au <span class="font-medium text-ink">{{ numeroAffiche }}</span>
      </p>

      <InputOtp
        v-model="code"
        :length="6"
        integer-only
        data-testid="champ-code"
      />

      <p
        v-if="codeDeDeveloppement"
        class="rounded-control bg-late-surface p-2 text-sm text-late-ink"
        data-testid="code-dev"
      >
        Développement — code : <strong>{{ codeDeDeveloppement }}</strong>
      </p>

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
        :disabled="code.length !== 6 || enCours"
        class="bg-brand text-brand-ink hover:bg-brand-strong"
        data-testid="bouton-valider-code"
      />
    </form>
  </div>
</template>
