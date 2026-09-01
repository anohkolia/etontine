import tailwindcss from '@tailwindcss/vite'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/icon',
    '@pinia/nuxt',
    '@vite-pwa/nuxt',
    'pinia-plugin-persistedstate/nuxt',
    '@primevue/nuxt-module',
  ],

  // Les composants de base s'écrivent <StatusBadge>, pas <UiStatusBadge> :
  // le dossier range, il ne renomme pas.
  components: [
    { path: '~/components/ui', pathPrefix: false },
    '~/components',
  ],

  // Le panneau flottant des DevTools se superpose au bas de l'écran et
  // intercepte les clics à 360 px : il fait échouer les tests de bout en bout
  // sur des boutons pourtant bien présents. Playwright pose `PLAYWRIGHT=1`.
  devtools: { enabled: !process.env.PLAYWRIGHT },

  app: {
    head: {
      // Sans `lang`, un lecteur d'écran prononce le français avec la
      // phonétique anglaise : « Aya Koné » devient inintelligible, et les
      // montants sont lus dans le mauvais ordre. C'est un défaut
      // d'accessibilité que Lighthouse relève, et à juste titre.
      htmlAttrs: { lang: 'fr' },
      meta: [
        { name: 'theme-color', content: '#0f6e5c' },
        // Le zoom n'est jamais bloqué : beaucoup de membres agrandissent le
        // texte, et une interface qui l'interdit leur est inutilisable.
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
      ],
    },
  },

  css: ['~/assets/css/main.css'],

  runtimeConfig: {
    public: {
      /**
       * Seuil d'alerte de plafond de portefeuille, en FCFA.
       *
       * Un compte de monnaie électronique est plafonné en solde et en
       * transaction (encadrement BCEAO, palier KYC du titulaire). Un pot de
       * 12 membres × 50 000 FCFA bute dessus. Le simulateur du wizard doit
       * prévenir l'organisateur **avant** qu'il démarre.
       *
       * La valeur n'est **pas codée en dur** : le cahier des charges impose de
       * la rendre configurable (§0.1). Elle est ici par défaut, surchargeable
       * par `NUXT_PUBLIC_POT_ALERT_THRESHOLD`, en attendant le back-office.
       */
      potAlertThreshold: 500_000,
    },
  },

  // Landing pré-rendue pour le SEO ; application authentifiée en SPA.
  // Aucune page personnalisée ne doit être rendue côté serveur.
  routeRules: {
    '/': { prerender: true },
    '/app/**': { ssr: false },
  },

  future: {
    compatibilityVersion: 4,
  },
  compatibilityDate: '2025-08-01',

  nitro: {
    /**
     * Pré-compresse les ressources statiques au build.
     *
     * Les budgets de CLAUDE.md (règle 15) portent sur le **compressé** : sans
     * cela, le serveur d'aperçu sert du JavaScript brut, Lighthouse mesure
     * trois fois le poids réel, et l'on croit dépasser un budget qu'on tient.
     * En production le proxy compresserait de toute façon — autant que la
     * mesure locale dise la vérité.
     */
    compressPublicAssets: { gzip: true, brotli: true },

    experimental: {
      tasks: true, // tâches planifiées : mark-late, open-next-round… (T13)
    },
    // Format d'erreur unique de l'API. Sans cela, Nitro rend son propre objet
    // et fait fuiter la pile d'appels dans la réponse.
    errorHandler: '~~/server/error.ts',

    /**
     * Tâches planifiées (docs/api-contract.md § Tâches planifiées).
     *
     * Toutes sont **idempotentes** : une exécution manquée se rattrape à la
     * suivante, et une exécution en double ne produit rien de neuf. C'est la
     * seule propriété qui rend un planificateur supportable en production.
     *
     * Les heures sont en UTC. Abidjan est à UTC+0 toute l'année, sans heure
     * d'été : les rappels tombent donc bien à l'heure locale annoncée.
     */
    scheduledTasks: {
      // Toutes les heures : un retard constaté avec une heure de décalage
      // reste juste, et cela évite un pic de charge à minuit.
      '0 * * * *': ['mark-late', 'escalate-declarations'],
      // 6 h du matin : le tour s'ouvre avant que la journée commence.
      '0 6 * * *': ['open-next-round'],
      // 8 h : les rappels partent à une heure décente. Les plages de silence
      // propres à chaque membre sont respectées en plus de cette heure fixe.
      '0 8 * * *': ['due-reminders'],
      // 8 h 30 : le contrôle des espèces non reconnues, une fois par jour.
      '30 8 * * *': ['unconfirmed-cash'],
    },
  },

  vite: {
    plugins: [tailwindcss()],
  },

  typescript: {
    strict: true,
    typeCheck: false, // `pnpm typecheck` lance vue-tsc séparément
  },

  eslint: {
    config: {
      stylistic: true,
    },
  },

  icon: {
    // Rendu en SVG inline, et surtout : aucun appel réseau à l'exécution.
    // `provider: 'none'` coupe la résolution distante ; `clientBundle.scan`
    // relève les noms d'icônes dans les sources et n'embarque que ceux-là.
    // C'est ce qui permet à l'application de fonctionner hors ligne (T24) —
    // une icône qui se télécharge est une icône absente dans le tramway.
    provider: 'none',
    mode: 'svg',
    clientBundle: {
      // Le relevé automatique ne voit que les `name="…"` écrits en clair dans
      // les gabarits. Les icônes de <StatusBadge> viennent d'une table et lui
      // échappent : sans cette liste, les badges s'affichent sans icône, et la
      // règle 10 tombe en silence. Un test unitaire vérifie que cette liste
      // reste alignée sur shared/constants/statuts.ts.
      icons: [
        'lucide:archive',
        'lucide:calendar',
        'lucide:circle-check',
        'lucide:circle-dashed',
        'lucide:clock',
        'lucide:door-open',
        'lucide:file-pen',
        'lucide:flag',
        'lucide:hand-coins',
        'lucide:log-out',
        'lucide:mail',
        'lucide:octagon-alert',
        'lucide:package',
        'lucide:play',
        'lucide:triangle-alert',
        'lucide:user-check',
        'lucide:user-x',
      ],
      scan: true,
      sizeLimitKb: 96,
    },
  },

  primevue: {
    // Mode unstyled : PrimeVue n'émet aucun CSS, tout le style vient de Tailwind.
    options: {
      unstyled: true,
      ripple: false,
    },
    // Préréglage pass-through global : le style des composants vit dans un seul
    // fichier, jamais au point d'appel. Voir app/primevue/pt.ts.
    importPT: { from: '~/primevue/pt' },
    // Imports explicites, composant par composant. Ne jamais passer à '*' :
    // chaque composant ajouté coûte du budget de poids (< 180 Ko de JS initial).
    // Stepper se décompose : StepList, Step, StepPanels et StepPanel sont des
    // composants distincts, il faut les déclarer un par un.
    components: {
      include: [
        'Button',
        'Card',
        'Dialog',
        'InputOtp',
        'InputText',
        'ProgressBar',
        'Step',
        'StepList',
        'StepPanel',
        'StepPanels',
        'Stepper',
        'Tag',
      ],
    },
    // Pas de directives ni de services tant qu'un écran n'en a pas besoin.
    directives: { include: [] },
    composables: { include: [] },
  },

  pwa: {
    registerType: 'autoUpdate',
    manifest: {
      name: 'eTontine',
      short_name: 'eTontine',
      description: 'La tontine de votre groupe, tenue au clair.',
      lang: 'fr',
      // `standalone` et non `fullscreen` : la barre d'état du système reste
      // visible, et avec elle l'heure et la batterie. Sur un téléphone qu'on
      // sort au marché, les masquer est une gêne, pas une immersion.
      display: 'standalone',
      orientation: 'portrait',
      background_color: '#ffffff',
      theme_color: '#0f6e5c',
      start_url: '/app',
      // Le point d'entrée de l'application authentifiée, pas la landing :
      // quelqu'un qui installe l'application veut sa tontine, pas la vitrine.
      scope: '/',
      icons: [
        { src: '/icones/icone-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icones/icone-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icones/icone-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    workbox: {
      // Les pages d'aide et la coquille de l'application sont mises en cache :
      // c'est ce qui permet d'ouvrir l'application sans réseau et d'y saisir
      // une déclaration, qui partira au retour de la connexion.
      globPatterns: ['**/*.{js,css,html,svg,woff2}'],
      navigateFallback: '/app',
      navigateFallbackDenylist: [/^\/api\//],
      runtimeCaching: [
        {
          // Les données financières ne sont **jamais** servies depuis le cache
          // (règle 12) : un dû périmé est pire qu'un écran vide. On passe par
          // le réseau, et l'échec est traité par l'état hors-ligne de l'écran.
          urlPattern: /^\/api\/v1\//,
          handler: 'NetworkOnly',
        },
      ],
    },
    client: {
      installPrompt: true,
    },
    devOptions: {
      // Le service worker en développement gêne les tests de bout en bout :
      // il intercepte les navigations et sert des réponses mises en cache.
      enabled: false,
      type: 'module',
    },
  },
})
