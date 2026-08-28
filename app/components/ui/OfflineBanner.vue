<script setup lang="ts">
/**
 * L'état hors-ligne des cinq états obligatoires (règle 14).
 *
 * Le bandeau ne se contente pas de signaler la coupure : il dit ce qui se
 * passe pour le membre. Une déclaration saisie sans réseau n'est pas perdue,
 * elle part à la reconnexion (file de mutations, T24). Sans cette phrase, le
 * membre renvoie son paiement une seconde fois.
 *
 * Ni couleur seule (règle 10), ni montant (règle 21).
 */
const online = useOnline()
const { enAttente, vider, rafraichir } = useFileHorsLigne()

/**
 * Au retour du réseau, la file part toute seule.
 *
 * Le membre n'a rien à faire, et surtout rien à refaire : c'est la promesse du
 * mode hors-ligne. Un bouton « synchroniser » reporterait sur lui une charge
 * qui revient à l'application.
 */
watch(online, async (connecte) => {
  if (connecte) await vider()
})

onMounted(async () => {
  await rafraichir()
  if (online.value) await vider()
})
</script>

<template>
  <div class="contents">
    <Transition
      enter-active-class="transition-[opacity,transform] duration-200"
      enter-from-class="-translate-y-full opacity-0"
      leave-active-class="transition-[opacity,transform] duration-200"
      leave-to-class="-translate-y-full opacity-0"
    >
      <div
        v-if="!online"
        class="flex items-center gap-2 bg-late-surface px-4 py-2 text-sm text-late-ink"
        role="status"
        data-testid="offline-banner"
      >
        <Icon
          name="lucide:wifi-off"
          size="1rem"
          class="shrink-0"
          aria-hidden="true"
        />
        <p>
          <strong class="font-semibold">Hors ligne.</strong>
          Ce que tu saisis est gardé et partira au retour du réseau.
          <span
            v-if="enAttente.length > 0"
            data-testid="file-en-attente"
          >
            {{ enAttente.length }} envoi(s) en attente.
          </span>
        </p>
      </div>
    </Transition>

    <!-- Reste visible une fois le réseau revenu, tant que la file n'est pas
       vidée : c'est le moment où le membre doute le plus. -->
    <div
      v-if="online && enAttente.length > 0"
      class="flex items-center gap-2 bg-declared-surface px-4 py-2 text-sm text-declared-ink"
      role="status"
      data-testid="bandeau-synchronisation"
    >
      <Icon
        name="lucide:refresh-cw"
        size="1rem"
        class="shrink-0 animate-spin"
        aria-hidden="true"
      />
      <p>Envoi de {{ enAttente.length }} saisie(s) en attente…</p>
    </div>
  </div>
</template>
