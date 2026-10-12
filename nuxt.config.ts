import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'

/**
 * Une révision par build, pour les pages que le service worker met en cache
 * sans qu'elles soient des fichiers du build (voir `pwa.workbox`). Chaque
 * déploiement les remet à jour, avec le JavaScript qu'elles appellent.
 */
const REVISION_DU_BUILD = Date.now().toString(36)

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/icon',
    '@nuxtjs/i18n',
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
        // Le nom sous l'icône, sur iPhone et iPad. Sans lui, iOS propose le
        // titre de la page ouverte — « Mes tontines — eTontine », tronqué.
        { name: 'apple-mobile-web-app-title', content: 'eTontine' },
      ],
      // Les icônes que chaque plateforme va chercher hors du manifeste :
      // l'iPhone et l'iPad l'ignorent et prennent `apple-touch-icon` — sans
      // elle, l'écran d'accueil reçoit une capture réduite de la page —, les
      // onglets prennent le favicon. Toutes sont tracées par
      // `scripts/icones.ts`.
      link: [
        { rel: 'icon', href: '/favicon.ico', sizes: '48x48' },
        { rel: 'icon', href: '/icones/icone.svg', type: 'image/svg+xml' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
        // Le manifeste. Il a longtemps été construit sans qu'aucune page n'y
        // renvoie : aucun navigateur ne proposait d'installer l'application.
        // Posé ici, il est dans **toutes** les pages servies — la coquille de
        // `/app` comprise, que le serveur ne rend pas et où un composant ne
        // l'ajouterait qu'une fois le JavaScript chargé. En développement, le
        // manifeste n'est pas servi : le lien n'y est pas posé non plus.
        ...(process.env.NODE_ENV === 'production'
          ? [{ rel: 'manifest' as const, href: '/manifest.webmanifest' }]
          : []),
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

      /**
       * Où régler l'abonnement.
       *
       * L'application n'encaisse rien : le président envoie le forfait de sa
       * poche, par mobile money, et un administrateur pose le palier depuis
       * le back-office. Sans ces quatre valeurs, l'écran d'abonnement disait
       * « le règlement se fait hors de l'application » — et personne ne
       * savait où. Surchargeables par `NUXT_PUBLIC_ABONNEMENT_REGLEMENT_*`.
       * Vides, l'écran renvoie vers l'adresse de contact de l'éditeur.
       */
      abonnementReglement: {
        operateur: '',
        numero: '',
        titulaire: '',
        /** Numéro WhatsApp où envoyer la capture du règlement. */
        contact: '',
      },
    },
  },

  // Landing pré-rendue pour le SEO ; application authentifiée en SPA.
  // Aucune page personnalisée ne doit être rendue côté serveur.
  routeRules: {
    '/': { prerender: true },
    // La grille tarifaire est éditoriale et publique : pré-rendue comme la
    // landing, elle est servie sans exécuter une ligne de JavaScript.
    '/tarifs': { prerender: true },
    // `docs/api-contract.md` fixe `/tarifs`. Le singulier circule pourtant
    // — c'est ce qu'on tape — et une redirection permanente coûte moins qu'une
    // page morte.
    '/tarif': { redirect: { to: '/tarifs', statusCode: 301 } },
    // Les pages légales sont éditoriales et publiques, pré-rendues comme la
    // grille tarifaire. Elles doivent se lire sans compte et sans JavaScript.
    '/legal/**': { prerender: true },
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

  hooks: {
    /**
     * Format d'erreur unique de l'API, **devant** la page d'erreur de Nuxt.
     *
     * Poser `nitro.errorHandler` directement remplaçait le gestionnaire de
     * Nuxt : les erreurs d'API sortaient bien au format du contrat, mais une
     * page introuvable ne rendait plus jamais `app/error.vue` — Nitro
     * répondait son objet JSON brut, pile d'appels comprise. Nitro accepte une
     * liste : le nôtre traite `/api/**` et laisse passer le reste, celui de
     * Nuxt rend alors la page d'erreur.
     */
    'nitro:config'(nitroConfig) {
      const api = fileURLToPath(new URL('./server/error.ts', import.meta.url))
      const existants = Array.isArray(nitroConfig.errorHandler)
        ? nitroConfig.errorHandler
        : nitroConfig.errorHandler ? [nitroConfig.errorHandler] : []
      nitroConfig.errorHandler = [api, ...existants]
    },

    /**
     * `/demo` est la page de vérification du socle — composants PrimeVue
     * habillés, états du design system. Utile en développement et testée de
     * bout en bout ; elle n'a rien à faire dans le lot de production, où elle
     * serait une page publique de plus à maintenir et à indexer.
     */
    'pages:extend'(pages) {
      if (process.env.NODE_ENV !== 'production') return
      const index = pages.findIndex(p => p.path === '/demo')
      if (index >= 0) pages.splice(index, 1)
    },
  },

  eslint: {
    config: {
      stylistic: true,
    },
  },

  /**
   * Toutes les chaînes de l'interface vivent dans `i18n/locales/fr.json`
   * (CLAUDE.md : « toutes les chaînes externalisées dès le départ »).
   *
   * Une seule langue aujourd'hui, sans préfixe d'adresse ni détection du
   * navigateur : `/app` reste `/app`, et un membre dont le téléphone est en
   * anglais lit le français qu'il attend. Ajouter une langue — le dioula, le
   * baoulé — revient à ajouter un fichier, pas à rouvrir les écrans.
   */
  i18n: {
    locales: [{ code: 'fr', language: 'fr-CI', name: 'Français', file: 'fr.json' }],
    defaultLocale: 'fr',
    strategy: 'no_prefix',
    detectBrowserLanguage: false,
    compilation: { strictMessage: false },
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
        'lucide:bell',
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
      // L'identité de l'application installée. Elle valait déjà `start_url`
      // par défaut : la poser telle quelle ne change rien aux installations
      // existantes, et la fige si `start_url` bouge un jour.
      id: '/app',
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
      categories: ['finance'],
      // Tracées par `scripts/icones.ts`. La 1024 px « maskable » est pour Safari
      // sur Mac : son Dock veut une icône pleine et opaque de cette taille, et
      // retombe sinon sur la première lettre du titre.
      icons: [
        { src: '/icones/icone-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icones/icone-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icones/icone-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        { src: '/icones/icone-1024-maskable.png', sizes: '1024x1024', type: 'image/png', purpose: 'maskable' },
      ],
    },
    workbox: {
      // Les écouteurs `push` et `notificationclick` vivent dans un script à
      // part, importé par le service worker généré. On garde ainsi `generateSW`
      // et toute sa mise en cache : basculer en `injectManifest` pour deux
      // écouteurs aurait demandé de réécrire ce qui fait marcher l'application
      // hors ligne.
      importScripts: ['/push-sw.js'],
      // Les pages d'aide et la coquille de l'application sont mises en cache :
      // c'est ce qui permet d'ouvrir l'application sans réseau et d'y saisir
      // une déclaration, qui partira au retour de la connexion.
      globPatterns: ['**/*.{js,css,html,svg,woff2}'],
      // … mais ni la coquille de `/app` ni l'aide ne sont des fichiers du
      // build : le serveur les rend à la demande, et `globPatterns` ne les
      // voyait pas. Faute de `/app` dans le cache, la retombée ci-dessous
      // faisait échouer Workbox au démarrage du service worker — en silence,
      // le reste étant déjà en cache — et l'application installée affichait la
      // page d'erreur du navigateur dès que le réseau tombait.
      // `scripts/verifier-bundle.ts` le vérifie désormais à chaque build.
      additionalManifestEntries: [
        { url: '/app', revision: REVISION_DU_BUILD },
        { url: '/aide', revision: REVISION_DU_BUILD },
      ],
      navigateFallback: '/app',
      // Seules les adresses de l'application retombent sur sa coquille — c'est
      // ce que le serveur y rend de toute façon. Les autres pages, rendues par
      // le serveur — connexion, invitation, pages légales —, le restent.
      navigateFallbackAllowlist: [/^\/app(?:[/?]|$)/],
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
      // L'invitation à installer est captée par `plugins/installation.client.ts`,
      // pas par le module : le sien ne sert que Chrome et ses dérivés, et son
      // « plus tard » était définitif — la proposition ne revenait jamais.
      installPrompt: false,
    },
    devOptions: {
      // Le service worker en développement gêne les tests de bout en bout :
      // il intercepte les navigations et sert des réponses mises en cache.
      enabled: false,
      type: 'module',
    },
  },
})
