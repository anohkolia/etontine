<script setup lang="ts">
/**
 * Navigation entre les écrans d'une même tontine.
 *
 * Inspirée des onglets `Membres / Journal` du template, adaptée à des routes
 * réelles plutôt qu'à un état local : chaque écran garde son adresse, donc son
 * lien partageable et son bouton retour.
 *
 * Elle comble un manque : jusqu'ici, passer du registre aux membres d'une même
 * tontine imposait de remonter au tableau de bord. Sur un téléphone, c'est
 * deux navigations et une attente réseau pour un aller-retour permanent.
 *
 * Le rôle vient du magasin de session, qui est un **cache d'affichage**
 * (règle 12) : il masque des onglets, il n'autorise rien. Un membre qui
 * forcerait l'adresse de `/confirmations` se ferait renvoyer par le serveur.
 */
const props = defineProps<{ tontineId: string }>()

const session = useSessionStore()
const route = useRoute()

const role = computed(() => session.roleDans(props.tontineId))
const bureau = computed(() => role.value === 'president' || role.value === 'treasurer')

const onglets = computed(() => {
  const base = `/app/tontine/${props.tontineId}`
  const communs = [
    // Le détail vient en premier : c'est l'écran qui répond aux deux questions
    // qu'on se pose en ouvrant une tontine — où en est le pot, quand je passe.
    { to: base, label: 'La tontine', icon: 'lucide:layout-dashboard' },
    { to: `${base}/cotiser`, label: 'Cotiser', icon: 'lucide:hand-coins' },
    { to: `${base}/membres`, label: 'Membres', icon: 'lucide:users' },
    { to: `${base}/registre`, label: 'Registre', icon: 'lucide:scroll-text' },
  ]
  if (!bureau.value) return communs

  const duBureau = [
    ...communs,
    { to: `${base}/confirmations`, label: 'Confirmer', icon: 'lucide:check-check' },
    { to: `${base}/impayes`, label: 'Impayés', icon: 'lucide:triangle-alert' },
    { to: `${base}/relances`, label: 'Relancer', icon: 'lucide:message-circle' },
    { to: `${base}/versement`, label: 'Verser', icon: 'lucide:package' },
  ]
  if (role.value !== 'president') return duBureau

  return [...duBureau, { to: `${base}/reglages`, label: 'Réglages', icon: 'lucide:settings' }]
})
</script>

<template>
  <!-- Défilement horizontal plutôt que repli : à 360 px, sept onglets ne
       tiennent pas, et un menu déroulant cacherait la navigation derrière un
       clic supplémentaire. -->
  <nav
    class="-mx-4 overflow-x-auto px-4"
    aria-label="Écrans de la tontine"
    data-testid="onglets-tontine"
  >
    <ul class="flex w-max gap-2">
      <li
        v-for="onglet in onglets"
        :key="onglet.to"
      >
        <NuxtLink
          :to="onglet.to"
          class="flex min-h-touch items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition-colors"
          :class="route.path === onglet.to
            ? 'border-brand bg-brand text-brand-ink'
            : 'border-line bg-surface text-ink-muted hover:text-ink'"
          :aria-current="route.path === onglet.to ? 'page' : undefined"
        >
          <Icon
            :name="onglet.icon"
            size="1rem"
            class="shrink-0"
            aria-hidden="true"
          />
          {{ onglet.label }}
        </NuxtLink>
      </li>
    </ul>
  </nav>
</template>
