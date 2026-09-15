<script setup lang="ts">
const { t } = useI18n()

/**
 * Landing publique, pré-rendue pour le SEO (`routeRules` dans nuxt.config.ts).
 *
 * Elle ne promet rien qui ne soit vrai, et surtout pas ce que le produit ne
 * fait pas : eTontine ne détient jamais de fonds (règle 5). Le dire d'emblée
 * n'est pas de la modestie, c'est la première objection de quiconque envisage
 * de confier son argent à une application — mieux vaut y répondre avant qu'elle
 * ne se pose.
 *
 * La mise en page reprend le hero du template : en-tête en dégradé, pastille de
 * pays, titre serré, deux boutons en pilule, aperçu d'écran à droite à partir
 * de `md`. Deux choses du template ne sont **pas** reprises :
 *
 * - **Les chiffres de traction** (« 12 400+ membres », « 380 M F collectés »)
 *   sont inventés. Les trois chiffres affichés ici sont des propriétés du
 *   produit, vérifiables : rien n'est détenu, tout est chaîné, le budget de
 *   poids est appliqué en CI.
 * - **La grille tarifaire** dépend du modèle de monétisation, que `CLAUDE.md`
 *   interdit de trancher seul.
 *
 * Aucune image, aucune police téléchargée, et **pas de <Icon>** : les
 * pictogrammes sont des SVG écrits en clair. Le système d'icônes coûterait une
 * dizaine de kilo-octets à cette page seule, pour des dessins qui ne changeront
 * jamais — or c'est le premier contact, souvent sur une connexion lente et
 * facturée à la donnée.
 */
useHead({
  title: t('public.landing.etontine_la_tontine_de'),
  meta: [
    {
      name: 'description',
      content:
        t('public.landing.cotisations_declarees_confirmees_par'),
    },
  ],
})

/**
 * Trois faits, pas trois statistiques d'usage. Chacun est vérifiable dans le
 * produit : aucun solde n'existe en base, le registre est chaîné par hachage,
 * le budget de poids fait échouer le build s'il est dépassé.
 */
const FAITS = [
  { valeur: t('public.landing.0_fcfa'), legende: t('public.landing.detenu_par_l_application') },
  { valeur: '100 %', legende: t('public.landing.des_ecritures_verifiables') },
  { valeur: t('public.landing.250_ko'), legende: t('public.landing.au_premier_chargement') },
] as const
</script>

<template>
  <div class="min-h-dvh">
    <header class="gradient-trust rounded-b-[2.5rem] px-5 pt-6 pb-14 text-night-ink">
      <nav class="mx-auto flex max-w-5xl items-center justify-between gap-3">
        <span class="text-base font-bold">{{ $t('public.landing.etontine') }}</span>
        <div class="flex items-center gap-2">
          <NuxtLink
            to="/tarifs"
            class="min-h-touch inline-flex items-center px-3 text-sm font-semibold text-night-ink/85 hover:text-night-ink"
            data-testid="lien-tarifs"
          >
            {{ $t('public.landing.tarifs') }}
          </NuxtLink>
          <NuxtLink
            to="/login"
            class="min-h-touch inline-flex items-center rounded-full bg-night-ink/15 px-4 text-sm font-semibold transition-colors hover:bg-night-ink/25"
            data-testid="lien-connexion"
          >
            {{ $t('public.landing.se_connecter') }}
          </NuxtLink>
        </div>
      </nav>

      <div class="mx-auto mt-12 max-w-5xl md:grid md:grid-cols-2 md:items-center md:gap-10">
        <div>
          <p class="inline-flex rounded-full bg-night-ink/15 px-3 py-1 text-xs font-semibold">
            {{ $t('public.landing.faite_pour_la_cote') }}
          </p>

          <h1 class="mt-4 text-4xl leading-tight font-bold md:text-5xl">
            {{ $t('public.landing.la_tontine_de_votre') }}
          </h1>

          <p class="mt-4 max-w-md leading-relaxed text-night-ink/80">
            {{ $t('public.landing.chaque_cotisation_est_declaree') }}
          </p>

          <!-- Règle 13 : l'action primaire est atteignable au pouce, sans défiler. -->
          <div class="mt-7 flex flex-col gap-3 sm:flex-row">
            <NuxtLink
              to="/app"
              class="min-h-touch inline-flex items-center justify-center rounded-full bg-brand px-6 font-semibold text-brand-ink shadow-float transition-transform hover:scale-[1.02] motion-reduce:transform-none"
              data-testid="lien-application"
            >
              {{ $t('public.landing.ouvrir_mon_application') }}
            </NuxtLink>
            <NuxtLink
              to="/aide"
              class="min-h-touch inline-flex items-center justify-center rounded-full border border-night-ink/30 px-6 font-semibold transition-colors hover:bg-night-ink/10"
              data-testid="lien-aide"
            >
              {{ $t('public.landing.comment_ca_marche') }}
            </NuxtLink>
          </div>

          <dl class="mt-8 grid grid-cols-3 gap-3 text-center">
            <div
              v-for="fait in FAITS"
              :key="fait.legende"
              class="rounded-tile bg-night-ink/10 p-3"
            >
              <dt class="amount text-lg font-bold">
                {{ fait.valeur }}
              </dt>
              <dd class="text-[11px] leading-snug text-night-ink/70">
                {{ fait.legende }}
              </dd>
            </div>
          </dl>
        </div>

        <!-- Aperçu d'écran. Explicitement présenté comme un exemple : ce sont
             des chiffres d'illustration, pas les données de quelqu'un. -->
        <div class="mt-12 md:mt-0">
          <div
            class="mx-auto w-full max-w-xs rounded-[2rem] border border-night-ink/15 bg-surface p-4 text-ink shadow-float"
            aria-hidden="true"
          >
            <p class="text-[11px] tracking-wide text-ink-muted uppercase">
              {{ $t('public.landing.exemple_tontine_du_marche') }}
            </p>
            <p class="amount text-2xl font-bold">
              {{ $t('public.landing.175_000_fcfa') }}
            </p>
            <div class="mt-2 h-2 overflow-hidden rounded-full bg-surface-sunken">
              <div class="gradient-pot h-full w-[70%] rounded-full" />
            </div>
            <p class="mt-1 text-xs text-ink-muted">
              {{ $t('public.landing.7_cotisations_confirmees_sur') }}
            </p>

            <ul class="mt-4 flex flex-col gap-2 text-xs">
              <li class="flex items-center justify-between gap-2">
                <span class="font-semibold">{{ $t('public.landing.aya_k') }}</span>
                <span class="rounded-full bg-confirmed-surface px-2 py-0.5 font-semibold text-confirmed-ink">{{ $t('public.landing.confirme') }}</span>
              </li>
              <li class="flex items-center justify-between gap-2">
                <span class="font-semibold">{{ $t('public.landing.mariam_t') }}</span>
                <span class="rounded-full bg-declared-surface px-2 py-0.5 font-semibold text-declared-ink">{{ $t('public.landing.declare') }}</span>
              </li>
              <li class="flex items-center justify-between gap-2">
                <span class="font-semibold">{{ $t('public.landing.fatou_b') }}</span>
                <span class="rounded-full bg-late-surface px-2 py-0.5 font-semibold text-late-ink">{{ $t('public.landing.en_retard') }}</span>
              </li>
            </ul>

            <p class="gradient-brand mt-4 rounded-control px-3 py-2.5 text-center text-xs font-bold text-brand-ink">
              {{ $t('public.landing.declarer_ma_cotisation') }}
            </p>
          </div>
        </div>
      </div>
    </header>

    <main class="mx-auto max-w-5xl px-5 py-14">
      <section>
        <h2 class="text-2xl font-bold text-ink">
          {{ $t('public.landing.pensee_pour_le_terrain') }}
        </h2>
        <p class="mt-1 text-ink-muted">
          {{ $t('public.landing.legere_en_donnees_rapide') }}
        </p>

        <ul class="mt-6 grid gap-3 sm:grid-cols-3">
          <li class="card-surface p-5">
            <span class="flex size-10 items-center justify-center rounded-tile bg-brand-surface text-brand-strong">
              <svg
                class="size-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M11 15h2a2 2 0 1 0 0-4h-3c-.6 0-1.1.2-1.4.6L3 17" />
                <path d="m7 21l1.6-1.4c.3-.4.8-.6 1.4-.6h4c1.1 0 2.1-.4 2.8-1.2l4.6-4.4a2 2 0 0 0-2.75-2.91l-4.2 3.9M2 16l6 6" />
                <circle
                  cx="16"
                  cy="9"
                  r="2.9"
                />
                <circle
                  cx="6"
                  cy="5"
                  r="3"
                />
              </svg>
            </span>
            <h3 class="mt-3 text-base font-bold text-ink">
              {{ $t('public.landing.votre_argent_ne_passe') }}
            </h3>
            <p class="mt-1 text-sm leading-relaxed text-ink-muted">
              {{ $t('public.landing.vous_envoyez_directement_sur') }}
            </p>
          </li>

          <li class="card-surface p-5">
            <span class="flex size-10 items-center justify-center rounded-tile bg-brand-surface text-brand-strong">
              <svg
                class="size-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M12 5v16m8.001-2A2 2 0 0 0 22 17V5a2 2 0 0 0-1.999-2L16 3.002A5 5 0 0 0 12 5a5 5 0 0 0-4-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 1.999 2H8a5 5 0 0 1 4 2a5 5 0 0 1 4-2z" />
              </svg>
            </span>
            <h3 class="mt-3 text-base font-bold text-ink">
              {{ $t('public.landing.un_registre_que_tout') }}
            </h3>
            <p class="mt-1 text-sm leading-relaxed text-ink-muted">
              {{ $t('public.landing.chaque_cotisation_confirmee_y') }}
            </p>
          </li>

          <li class="card-surface p-5">
            <span class="flex size-10 items-center justify-center rounded-tile bg-brand-surface text-brand-strong">
              <svg
                class="size-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="m18 14l4 4l-4 4m0-20l4 4l-4 4" />
                <path d="M2 18h1.973a4 4 0 0 0 3.3-1.7l5.454-8.6a4 4 0 0 1 3.3-1.7H22M2 6h1.972a4 4 0 0 1 3.6 2.2M22 18h-6.041a4 4 0 0 1-3.3-1.8l-.359-.45" />
              </svg>
            </span>
            <h3 class="mt-3 text-base font-bold text-ink">
              {{ $t('public.landing.l_ordre_de_passage') }}
            </h3>
            <p class="mt-1 text-sm leading-relaxed text-ink-muted">
              {{ $t('public.landing.le_tirage_au_sort') }}
            </p>
          </li>
        </ul>
      </section>

      <section class="mt-14 card-surface flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 class="text-lg font-bold text-ink">
            {{ $t('public.landing.vous_avez_recu_un') }}
          </h2>
          <p class="mt-1 text-sm text-ink-muted">
            {{ $t('public.landing.ouvrez_le_vous_verrez') }}
          </p>
        </div>
        <NuxtLink
          to="/aide"
          class="min-h-touch inline-flex shrink-0 items-center justify-center rounded-full border border-line-strong px-6 font-semibold text-ink"
        >
          {{ $t('public.landing.comprendre_d_abord') }}
        </NuxtLink>
      </section>
    </main>

    <footer class="flex flex-col items-center gap-3 border-t border-line px-5 py-8 text-center text-xs text-ink-muted">
      <nav class="flex flex-wrap items-center justify-center gap-4">
        <NuxtLink
          to="/tarifs"
          class="min-h-touch inline-flex items-center text-brand underline underline-offset-4"
        >
          {{ $t('public.landing.tarifs') }}
        </NuxtLink>
        <NuxtLink
          to="/aide"
          class="min-h-touch inline-flex items-center text-brand underline underline-offset-4"
        >
          {{ $t('public.landing.aide') }}
        </NuxtLink>
        <NuxtLink
          to="/legal/cgu"
          class="min-h-touch inline-flex items-center text-brand underline underline-offset-4"
          data-testid="lien-cgu"
        >
          {{ $t('public.landing.conditions') }}
        </NuxtLink>
        <NuxtLink
          to="/legal/confidentialite"
          class="min-h-touch inline-flex items-center text-brand underline underline-offset-4"
          data-testid="lien-confidentialite"
        >
          {{ $t('public.landing.confidentialite') }}
        </NuxtLink>
        <NuxtLink
          to="/legal/mentions"
          class="min-h-touch inline-flex items-center text-brand underline underline-offset-4"
        >
          {{ $t('public.landing.mentions_legales') }}
        </NuxtLink>
      </nav>
      <p>
        {{ $t('public.landing.etontine_abidjan_cote_d') }}
      </p>
    </footer>
  </div>
</template>

<!--
  États d'écran (règle 14) :
  · chargement — sans objet : page pré-rendue, aucun appel réseau
  · vide       — sans objet : contenu éditorial fixe
  · erreur     — sans objet : rien ne peut échouer côté client
  · hors-ligne — sans objet : la page est servie depuis le cache du service worker
  · contenu    — la landing
-->
