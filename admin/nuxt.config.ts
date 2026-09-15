import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'

/**
 * Back-office — application **distincte** de celle des membres.
 *
 * `docs/cahier-des-charges.md` §555 : « Interface distincte, desktop-first.
 * **Ne pas le mélanger au code de l'app membre.** »
 *
 * La séparation est réelle : propre configuration, propre build, propre
 * serveur Nitro. Le serveur des membres n'expose **aucune** route
 * d'administration — le compromettre ne donne aucun accès aux dossiers
 * d'identité.
 *
 * Ce qui est partagé l'est délibérément, et seulement ce qui doit l'être :
 * les schémas Zod, l'accès à la base et les services métier. Les dupliquer
 * créerait deux sources de vérité sur des états d'argent, ce que CLAUDE.md
 * interdit — et ce serait bien plus dangereux que le partage.
 */
export default defineNuxtConfig({
  modules: ['@nuxt/eslint', '@nuxt/icon', '@nuxtjs/i18n', '@primevue/nuxt-module'],

  // Les composants et composables du design system sont réutilisés, pas
  // recopiés : une seule définition de <StatusBadge> et de useMoney().
  components: [
    { path: fileURLToPath(new URL('../app/components/ui', import.meta.url)), pathPrefix: false },
    { path: fileURLToPath(new URL('./components', import.meta.url)), pathPrefix: false },
  ],

  imports: {
    dirs: [fileURLToPath(new URL('../app/composables', import.meta.url))],
  },

  devtools: { enabled: !process.env.PLAYWRIGHT },

  app: {
    head: {
      htmlAttrs: { lang: 'fr' },
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        // Un back-office n'a rien à faire dans un moteur de recherche.
        { name: 'robots', content: 'noindex, nofollow' },
      ],
    },
  },

  css: [fileURLToPath(new URL('../app/assets/css/main.css', import.meta.url))],

  /**
   * `#shared` pointe par défaut sur le dossier `shared/` de **cette**
   * application — qui n'existe pas. Les composants réutilisés du design system
   * l'utilisent pourtant (`StatusBadge` lit la table des statuts), et sans cet
   * alias ils ne se résolvent pas : la page tombe en erreur de navigation, sans
   * autre indice qu'un import introuvable.
   */
  alias: {
    '#shared': fileURLToPath(new URL('../shared', import.meta.url)),
  },

  // Aucune page n'est publique ni pré-rendue : tout est derrière l'authentification.
  routeRules: {
    '/**': { ssr: false, robots: false },
  },

  compatibilityDate: '2025-08-01',

  nitro: {
    compressPublicAssets: { gzip: true, brotli: true },
    errorHandler: fileURLToPath(new URL('../server/error.ts', import.meta.url)),
  },

  vite: { plugins: [tailwindcss()] },

  typescript: { strict: true, typeCheck: false },

  eslint: { config: { stylistic: true } },

  /**
   * Les composants réutilisés du design system lisent leurs mots dans le
   * fichier de langue de l'application des membres — `<StatusBadge>`,
   * `<ErrorState>`, `<OfflineBanner>`. Le back-office charge donc le même
   * fichier : une seule liste de mots, deux applications qui les lisent.
   */
  i18n: {
    restructureDir: fileURLToPath(new URL('../i18n', import.meta.url)),
    locales: [{ code: 'fr', language: 'fr-CI', name: 'Français', file: 'fr.json' }],
    defaultLocale: 'fr',
    strategy: 'no_prefix',
    detectBrowserLanguage: false,
    compilation: { strictMessage: false },
  },

  icon: {
    provider: 'none',
    mode: 'svg',
    clientBundle: { scan: true, sizeLimitKb: 64 },
  },

  primevue: {
    options: { unstyled: true, ripple: false },
    importPT: { from: fileURLToPath(new URL('../app/primevue/pt.ts', import.meta.url)) },
    components: { include: ['Button', 'InputText', 'InputOtp', 'Tag'] },
    directives: { include: [] },
    composables: { include: [] },
  },
})
