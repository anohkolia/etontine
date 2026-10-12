<script setup lang="ts">
/**
 * Les organisateurs — ceux qui viennent monter des tontines.
 *
 * Chaque arrivée est **signalée** : un compte qui s'inscrit sans lien
 * d'invitation, ou un membre qui crée sa première tontine. Les administrateurs
 * en reçoivent l'alerte par e-mail, et l'onglet porte un badge tant que
 * personne ne l'a prise en compte. Prendre en compte est un geste journalisé :
 * une alerte qui disparaît doit avoir un auteur.
 */
interface Organisateur {
  userId: string
  phone: string
  email: string | null
  firstName: string | null
  lastName: string | null
  organizerSince: string
  seenAt: string | null
  kycStatus: 'none' | 'pending_review' | 'approved' | 'rejected'
  kycLevel: number
  palier: 'free' | 'standard' | 'plus'
  tontines: { brouillons: number, actives: number, terminees: number }
}

const { formatDate } = useDate()
const alertes = useAlertesAdmin()

const etat = ref<'chargement' | 'contenu' | 'erreur'>('chargement')
const onglet = ref<'nouveaux' | 'tous'>('nouveaux')
const liste = ref<Organisateur[]>([])
const nbNouveaux = ref(0)
const erreur = ref<string | null>(null)
const enCours = ref<string | null>(null)

const PALIERS: Record<Organisateur['palier'], string> = { free: 'Gratuit', standard: 'Standard', plus: 'Plus' }

/** L'état de l'identité, en mot et en icône — jamais par la couleur seule (règle 10). */
function identite(o: Organisateur): { libelle: string, icone: string, classes: string } {
  if (o.kycLevel >= 2) return { libelle: 'Identité vérifiée', icone: 'lucide:shield-check', classes: 'bg-confirmed-surface text-confirmed-ink' }
  if (o.kycStatus === 'pending_review') return { libelle: 'Dossier en examen', icone: 'lucide:clock', classes: 'bg-declared-surface text-declared-ink' }
  if (o.kycStatus === 'rejected') return { libelle: 'Dossier refusé', icone: 'lucide:octagon-alert', classes: 'bg-disputed-surface text-disputed-ink' }
  return { libelle: 'Identité non vérifiée', icone: 'lucide:shield-alert', classes: 'bg-late-surface text-late-ink' }
}

function tontines(o: Organisateur): string {
  const { brouillons, actives, terminees } = o.tontines
  const parties = [
    brouillons > 0 ? `${brouillons} brouillon${brouillons > 1 ? 's' : ''}` : null,
    actives > 0 ? `${actives} active${actives > 1 ? 's' : ''}` : null,
    terminees > 0 ? `${terminees} terminée${terminees > 1 ? 's' : ''}` : null,
  ].filter(Boolean)
  return parties.length > 0 ? `Tontines : ${parties.join(' · ')}` : 'Aucune tontine pour l’instant'
}

function nom(o: Organisateur): string {
  return [o.firstName, o.lastName].filter(Boolean).join(' ') || 'Nom non renseigné'
}

function message(e: unknown): string {
  return (e as { data?: { error?: { message?: string } } })?.data?.error?.message
    ?? 'Impossible de joindre le serveur.'
}

async function charger() {
  etat.value = 'chargement'
  try {
    const reponse = await $fetch<{ organisateurs: Organisateur[], nbNouveaux: number }>(
      `/api/organisateurs?etat=${onglet.value}`,
    )
    liste.value = reponse.organisateurs
    nbNouveaux.value = reponse.nbNouveaux
    alertes.organisateurs.value = reponse.nbNouveaux
    etat.value = 'contenu'
  }
  catch (e) {
    erreur.value = message(e)
    etat.value = 'erreur'
  }
}

async function prendreEnCompte(userId: string) {
  erreur.value = null
  enCours.value = userId
  try {
    await $fetch(`/api/organisateurs/${userId}/acknowledge`, { method: 'POST' })
    await charger()
  }
  catch (e) {
    erreur.value = message(e)
  }
  finally {
    enCours.value = null
  }
}

watch(onglet, charger)
onMounted(charger)

useHead({ title: 'Organisateurs — Administration' })
</script>

<template>
  <div class="flex flex-col gap-5">
    <header class="flex items-baseline justify-between gap-4">
      <h1 class="text-xl font-bold text-ink">
        Organisateurs
      </h1>
      <p
        v-if="nbNouveaux > 0"
        class="text-sm text-ink-muted"
        data-testid="compteur-nouveaux"
      >
        {{ nbNouveaux }} {{ nbNouveaux > 1 ? 'nouveaux' : 'nouveau' }}
      </p>
    </header>

    <div class="flex gap-1 border-b border-line">
      <button
        v-for="choix in [
          { clef: 'nouveaux' as const, libelle: 'Nouveaux' },
          { clef: 'tous' as const, libelle: 'Tous' },
        ]"
        :key="choix.clef"
        type="button"
        class="min-h-touch border-b-2 px-4 text-sm font-medium"
        :class="onglet === choix.clef
          ? 'border-brand text-ink'
          : 'border-transparent text-ink-muted hover:text-ink'"
        :data-testid="`filtre-${choix.clef}`"
        @click="onglet = choix.clef"
      >
        {{ choix.libelle }}
      </button>
    </div>

    <LoadingSkeleton
      v-if="etat === 'chargement'"
      variant="list"
      :count="4"
    />

    <ErrorState
      v-else-if="etat === 'erreur'"
      :detail="erreur ?? undefined"
      @retry="charger"
    />

    <EmptyState
      v-else-if="liste.length === 0"
      :title="onglet === 'nouveaux' ? 'Aucune nouvelle arrivée' : 'Aucun organisateur'"
      :description="onglet === 'nouveaux'
        ? 'Les organisateurs qui s’inscrivent apparaîtront ici jusqu’à ce qu’un administrateur les prenne en compte.'
        : 'Les comptes qui organisent des tontines s’afficheront ici.'"
      icon="lucide:user-plus"
    />

    <!-- Des cartes, pas un tableau : chaque ligne porte un geste, pas une
         donnée à comparer. -->
    <ul
      v-else
      class="flex flex-col gap-2"
      data-testid="liste-organisateurs"
    >
      <li
        v-for="o in liste"
        :key="o.userId"
        class="card-surface flex flex-col gap-3 p-4"
        :data-testid="`organisateur-${o.userId}`"
      >
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="flex flex-col gap-0.5">
            <span class="font-medium text-ink">{{ nom(o) }}</span>
            <span class="font-mono text-sm tabular-nums text-ink-muted">{{ o.phone }}</span>
            <span
              v-if="o.email"
              class="text-sm text-ink-muted"
            >{{ o.email }}</span>
            <span class="text-sm text-ink-subtle">
              Organise depuis le {{ formatDate(o.organizerSince) }}
            </span>
          </div>

          <div class="flex flex-col items-end gap-1.5 text-right">
            <span
              class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
              :class="identite(o).classes"
              :data-testid="`identite-${o.userId}`"
            >
              <Icon
                :name="identite(o).icone"
                size="0.875rem"
                aria-hidden="true"
              />
              {{ identite(o).libelle }}
            </span>
            <span class="text-sm text-ink-muted">Palier {{ PALIERS[o.palier] }}</span>
          </div>
        </div>

        <p class="text-sm text-ink-muted">
          {{ tontines(o) }}
        </p>

        <div class="flex flex-wrap items-center gap-3">
          <Button
            v-if="!o.seenAt"
            type="button"
            :label="enCours === o.userId ? 'Enregistrement…' : 'Marquer comme pris en compte'"
            :disabled="enCours === o.userId"
            class="bg-brand text-brand-ink hover:bg-brand-strong"
            :data-testid="`prendre-en-compte-${o.userId}`"
            @click="prendreEnCompte(o.userId)"
          />
          <span
            v-else
            class="flex items-center gap-1.5 text-sm text-confirmed-ink"
          >
            <Icon
              name="lucide:circle-check"
              size="1rem"
              aria-hidden="true"
            />
            Pris en compte le {{ formatDate(o.seenAt) }}
          </span>

          <NuxtLink
            v-if="o.kycStatus !== 'none'"
            :to="`/dossiers/${o.userId}`"
            class="min-h-touch inline-flex items-center text-sm text-brand underline underline-offset-4"
          >
            Voir le dossier d’identité
          </NuxtLink>
        </div>
      </li>
    </ul>

    <p
      v-if="erreur && etat === 'contenu'"
      role="alert"
      class="text-sm text-disputed-ink"
      data-testid="erreur-action"
    >
      {{ erreur }}
    </p>
  </div>
</template>

<!--
  États d'écran (règle 14) :
  · chargement — LoadingSkeleton
  · vide       — EmptyState, distinct selon l'onglet
  · erreur     — ErrorState au chargement, message en ligne sur une action
  · hors-ligne — sans objet : back-office desktop, sur poste connecté
  · contenu    — la liste des organisateurs
-->
