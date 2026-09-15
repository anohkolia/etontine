<script setup lang="ts">
import type { MembershipRole } from '#shared/schemas'

const { t } = useI18n()

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
const props = defineProps<{
  tontineId: string
  /**
   * Le rôle tel que le serveur vient de le dire, quand l'écran l'a sous la
   * main. Le cache de session peut être en retard d'une nomination : sans ce
   * rattrapage, un trésorier fraîchement nommé ne voyait ses onglets qu'après
   * un rechargement complet.
   */
  role?: MembershipRole | null
}>()

const session = useSessionStore()
const route = useRoute()

const role = computed(() => props.role ?? session.roleDans(props.tontineId))

watch(() => props.role, (recu) => {
  if (recu && recu !== session.roleDans(props.tontineId)) session.charger(true)
}, { immediate: true })

const bureau = computed(() => role.value === 'president' || role.value === 'treasurer')

const onglets = computed(() => {
  const base = `/app/tontine/${props.tontineId}`
  const communs = [
    // Le détail vient en premier : c'est l'écran qui répond aux deux questions
    // qu'on se pose en ouvrant une tontine — où en est le pot, quand je passe.
    { to: base, label: t('commun.retour_tontine'), icon: 'lucide:layout-dashboard' },
    { to: `${base}/cotiser`, label: t('ui.TontineTabs.cotiser'), icon: 'lucide:hand-coins' },
    { to: `${base}/membres`, label: t('ui.TontineTabs.membres'), icon: 'lucide:users' },
    { to: `${base}/registre`, label: t('ui.TontineTabs.registre'), icon: 'lucide:scroll-text' },
    // Mon point de vue sur le cycle : ce que j'ai cotisé, ce que j'ai reçu,
    // et les reçus des tours passés — que « Cotiser » ne montre plus une fois
    // le tour clos.
    { to: `${base}/historique`, label: t('ui.TontineTabs.historique'), icon: 'lucide:history' },
  ]

  // Le censeur n'est pas du bureau qui encaisse et confirme, mais c'est lui
  // qui rouvre une cotisation rejetée et tranche les contestations : sans cet
  // onglet, il n'avait aucun chemin vers l'écran où ces gestes l'attendent.
  if (role.value === 'auditor') {
    return [...communs, { to: `${base}/impayes`, label: t('ui.TontineTabs.impayes'), icon: 'lucide:triangle-alert' }]
  }

  if (!bureau.value) return communs

  const duBureau = [
    ...communs,
    { to: `${base}/confirmations`, label: t('ui.TontineTabs.confirmer'), icon: 'lucide:check-check' },
    { to: `${base}/impayes`, label: t('ui.TontineTabs.impayes'), icon: 'lucide:triangle-alert' },
    { to: `${base}/relances`, label: t('ui.TontineTabs.relancer'), icon: 'lucide:message-circle' },
    { to: `${base}/versement`, label: t('ui.TontineTabs.verser'), icon: 'lucide:package' },
  ]
  if (role.value !== 'president') return duBureau

  return [...duBureau, { to: `${base}/reglages`, label: t('ui.TontineTabs.reglages'), icon: 'lucide:settings' }]
})
</script>

<template>
  <!-- Défilement horizontal plutôt que repli : à 360 px, sept onglets ne
       tiennent pas, et un menu déroulant cacherait la navigation derrière un
       clic supplémentaire. -->
  <nav
    class="-mx-4 overflow-x-auto px-4"
    :aria-label="$t('ui.TontineTabs.ecrans_de_la_tontine')"
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
