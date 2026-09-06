<script setup lang="ts">
import type { PlanPeriodicity } from '#shared/constants/abonnement'
import { AVANTAGES_COMMUNS, MOIS_OFFERTS, PALIERS, libelleLimite } from '#shared/constants/abonnement'

/**
 * Grille tarifaire publique, pré-rendue pour le SEO.
 *
 * Ce que cette page tient à dire avant de dire un prix : **rien de ce qui
 * touche à la confiance n'est payant**. Le registre, les preuves, les reçus, le
 * contrôle d'intégrité et le procès-verbal PDF restent gratuits à tous les
 * paliers. C'est `AVANTAGES_COMMUNS`, affiché au-dessus de la grille et pas en
 * bas de page : quelqu'un qui hésite à confier la comptabilité de son groupe à
 * une application se demande d'abord ce qu'on lui retirera s'il ne paie pas. La
 * réponse est « rien », et elle doit se lire sans défiler.
 *
 * Ce qui se paie est un **confort d'organisateur** : plusieurs tontines de
 * front, des groupes plus nombreux. Le forfait est payé par le président, de sa
 * poche : la caisse du groupe n'est jamais débitée, et l'application ne propose
 * aucun mécanisme pour la faire payer (règle 5).
 *
 * Comme la landing, **aucun `<Icon>`** : les pictogrammes sont des SVG écrits
 * en clair. Le système d'icônes coûterait une dizaine de kilo-octets à cette
 * seule page, souvent atteinte sur une connexion facturée à la donnée.
 */
useHead({
  title: 'Tarifs — eTontine',
  meta: [{
    name: 'description',
    content: 'Trois paliers, au forfait. Le registre, les preuves et les reçus '
      + 'restent gratuits à tous les paliers.',
  }],
})

const { format } = useMoney()

const periodicite = ref<PlanPeriodicity>('monthly')

/** Le prix affiché pour le palier, selon la bascule. */
function prix(palier: (typeof PALIERS)[number]): number {
  return periodicite.value === 'yearly' ? palier.prixAnnuel : palier.prixMensuel
}

const QUESTIONS = [
  {
    q: 'Qui paie l’abonnement ?',
    r: 'Le président, de sa poche. On ne touche jamais à la caisse du groupe : '
      + 'l’application ne détient pas les fonds de la tontine, et ne propose '
      + 'aucun moyen de les faire payer à sa place.',
  },
  {
    q: 'Prenez-vous un pourcentage sur les cotisations ?',
    r: 'Jamais. C’est un forfait, quel que soit le montant qui circule dans '
      + 'vos tontines. Nous ne voyons pas passer votre argent : il va '
      + 'directement du membre au numéro de collecte du président.',
  },
  {
    q: 'Que perd-on en restant au palier gratuit ?',
    r: 'Rien de ce qui protège le groupe. Le registre complet, les preuves de '
      + 'paiement, les reçus vérifiables, le contrôle d’intégrité et le '
      + 'procès-verbal de fin de cycle sont inclus partout. Le palier gratuit '
      + 'limite le nombre de tontines menées en même temps et la taille du groupe.',
  },
  {
    q: 'Que se passe-t-il si j’atteins la limite ?',
    r: 'Vos tontines en cours continuent normalement, jusqu’au bout du cycle. '
      + 'Rien n’est bloqué ni effacé. Vous ne pouvez simplement pas en ouvrir '
      + 'une nouvelle, ni dépasser le nombre de membres, tant que vous êtes '
      + 'au-dessus de la limite.',
  },
  {
    q: 'Comment se paie l’abonnement ?',
    r: 'À la main, au mois ou à l’année. Il n’y a pas de prélèvement '
      + 'automatique : sur les moyens de paiement disponibles ici, un '
      + 'prélèvement récurrent n’est pas fiable, et nous préférons ne rien '
      + 'promettre que nous ne tenons pas.',
  },
] as const
</script>

<template>
  <div class="min-h-dvh">
    <header class="gradient-trust rounded-b-[2.5rem] px-5 pt-6 pb-12 text-night-ink">
      <nav class="mx-auto flex max-w-5xl items-center justify-between gap-3">
        <NuxtLink
          to="/"
          class="text-base font-bold"
        >
          eTontine
        </NuxtLink>
        <NuxtLink
          to="/login"
          class="min-h-touch inline-flex items-center rounded-full bg-night-ink/15 px-4 text-sm font-semibold transition-colors hover:bg-night-ink/25"
          data-testid="lien-connexion"
        >
          Se connecter
        </NuxtLink>
      </nav>

      <div class="mx-auto mt-10 max-w-2xl text-center">
        <h1 class="text-3xl font-bold md:text-4xl">
          Un forfait, jamais un pourcentage
        </h1>
        <p class="mt-3 leading-relaxed text-night-ink/80">
          Ce que vous payez, c’est le confort d’organiser plusieurs groupes.
          Jamais la confiance : le registre et les preuves restent gratuits à
          tous les paliers.
        </p>
      </div>
    </header>

    <main class="mx-auto max-w-5xl px-5 py-10">
      <!-- Ce qui est gratuit partout, AVANT la grille. C'est la première
           question de quiconque hésite, et elle mérite mieux qu'une note de
           bas de page. -->
      <section
        class="card-surface p-5"
        data-testid="avantages-communs"
      >
        <h2 class="text-lg font-bold text-ink">
          Inclus à tous les paliers, gratuit compris
        </h2>
        <ul class="mt-3 grid gap-2 sm:grid-cols-2">
          <li
            v-for="avantage in AVANTAGES_COMMUNS"
            :key="avantage"
            class="flex items-start gap-2 text-sm leading-relaxed text-ink-muted"
          >
            <svg
              class="mt-0.5 size-4 shrink-0 text-brand-strong"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
            {{ avantage }}
          </li>
        </ul>
      </section>

      <!-- Bascule mensuel / annuel. Un groupe de boutons radio et non deux
           boutons : l'état sélectionné doit être annoncé par le lecteur
           d'écran, pas seulement peint. -->
      <fieldset class="mt-10 flex flex-col items-center gap-2">
        <legend class="sr-only">
          Périodicité de paiement
        </legend>
        <div class="inline-flex rounded-full border border-line bg-surface p-1">
          <label
            v-for="choix in [
              { clef: 'monthly' as const, libelle: 'Au mois' },
              { clef: 'yearly' as const, libelle: 'À l’année' },
            ]"
            :key="choix.clef"
            class="min-h-touch inline-flex cursor-pointer items-center rounded-full px-5 text-sm font-semibold"
            :class="periodicite === choix.clef
              ? 'bg-brand text-brand-ink'
              : 'text-ink-muted hover:text-ink'"
            :data-testid="`periodicite-${choix.clef}`"
          >
            <!-- Le bouton radio est masqué à l'œil mais bien présent : c'est
                 lui qui porte l'état pour le lecteur d'écran et le clavier.
                 C'est l'étiquette qu'on désigne au doigt — d'où sa cible de
                 44 px et son identifiant de test. -->
            <input
              v-model="periodicite"
              type="radio"
              name="periodicite"
              :value="choix.clef"
              class="sr-only"
            >
            {{ choix.libelle }}
          </label>
        </div>
        <p class="text-sm text-ink-muted">
          À l’année, {{ MOIS_OFFERTS }} mois sont offerts.
        </p>
      </fieldset>

      <!-- Cartes empilées sur mobile, jamais un tableau comparatif (règle 11). -->
      <ul
        class="mt-6 grid gap-4 md:grid-cols-3"
        data-testid="grille-paliers"
      >
        <li
          v-for="palier in PALIERS"
          :key="palier.id"
          class="card-surface flex flex-col gap-4 p-5"
          :class="palier.id === 'standard' ? 'border-brand ring-1 ring-brand' : ''"
          :data-testid="`palier-${palier.id}`"
        >
          <div>
            <h2 class="text-lg font-bold text-ink">
              {{ palier.nom }}
            </h2>
            <p
              class="amount mt-1 text-2xl font-bold text-ink"
              :data-testid="`prix-${palier.id}`"
            >
              {{ palier.prixMensuel === 0 ? 'Gratuit' : format(prix(palier)) }}
            </p>
            <p
              v-if="palier.prixMensuel > 0"
              class="text-sm text-ink-muted"
            >
              {{ periodicite === 'yearly' ? 'par an' : 'par mois' }}, payé par le président
            </p>
            <p
              v-else
              class="text-sm text-ink-muted"
            >
              sans limite de durée
            </p>
          </div>

          <dl class="flex flex-col gap-2 border-y border-line py-3 text-sm">
            <div class="flex items-baseline justify-between gap-3">
              <dt class="text-ink-muted">
                Tontines en cours
              </dt>
              <dd
                class="font-semibold text-ink"
                :data-testid="`quota-tontines-${palier.id}`"
              >
                {{ libelleLimite(palier.tontinesActives) }}
              </dd>
            </div>
            <div class="flex items-baseline justify-between gap-3">
              <dt class="text-ink-muted">
                Membres par tontine
              </dt>
              <dd
                class="font-semibold text-ink"
                :data-testid="`quota-membres-${palier.id}`"
              >
                {{ libelleLimite(palier.membresParTontine) }}
              </dd>
            </div>
          </dl>

          <ul class="flex flex-col gap-2 text-sm leading-relaxed text-ink-muted">
            <li
              v-for="apport in palier.apports"
              :key="apport"
              class="flex items-start gap-2"
            >
              <svg
                class="mt-0.5 size-4 shrink-0 text-brand-strong"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
              {{ apport }}
            </li>
          </ul>

          <NuxtLink
            to="/app/abonnement"
            class="min-h-touch mt-auto inline-flex items-center justify-center rounded-full px-5 text-sm font-semibold"
            :class="palier.id === 'free'
              ? 'border border-line-strong text-ink hover:bg-surface-muted'
              : 'bg-brand text-brand-ink hover:bg-brand-strong'"
            :data-testid="`choisir-${palier.id}`"
          >
            {{ palier.id === 'free' ? 'Commencer sans payer' : `Passer au palier ${palier.nom}` }}
          </NuxtLink>
        </li>
      </ul>

      <section class="mt-12">
        <h2 class="text-2xl font-bold text-ink">
          Les questions qu’on nous pose
        </h2>
        <dl class="mt-5 flex flex-col gap-3">
          <div
            v-for="item in QUESTIONS"
            :key="item.q"
            class="card-surface flex flex-col gap-2 p-5"
          >
            <dt class="font-semibold text-ink">
              {{ item.q }}
            </dt>
            <dd class="leading-relaxed text-ink-muted">
              {{ item.r }}
            </dd>
          </div>
        </dl>
      </section>

      <NuxtLink
        to="/"
        class="min-h-touch mt-8 inline-flex items-center gap-2 text-sm text-brand underline underline-offset-4"
      >
        Retour à l’accueil
      </NuxtLink>
    </main>

    <footer class="border-t border-line px-5 py-8 text-center text-xs text-ink-muted">
      eTontine — Abidjan, Côte d’Ivoire. L’application ne détient jamais les
      fonds : elle enregistre ce que le groupe déclare et confirme.
    </footer>
  </div>
</template>

<!--
  États d'écran (règle 14) :
  · chargement — sans objet : page pré-rendue, aucun appel réseau
  · vide       — sans objet : la grille a toujours ses trois paliers
  · erreur     — sans objet : rien ne peut échouer côté client
  · hors-ligne — servie depuis le cache du service worker
  · contenu    — la grille et les questions
-->
