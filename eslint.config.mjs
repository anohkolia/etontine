// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt(
  {
    ignores: [
      '.nuxt/**',
      '.output/**',
      'dist/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'server/db/migrations/**',
    ],
  },
  {
    // Les pages du back-office sont des routes : leur nom vient du chemin, et
    // un nom composé y serait un contresens. Nuxt exempte automatiquement
    // `app/pages`, mais la configuration générée ne connaît pas la seconde
    // application.
    files: ['admin/pages/**/*.vue', 'admin/layouts/**/*.vue'],
    rules: { 'vue/multi-word-component-names': 'off' },
  },
  {
    // Règle 7 de CLAUDE.md : un montant ne se formate jamais à la main dans un
    // composant. `useMoney()` est le seul point de formatage autorisé (T03).
    files: ['app/components/**/*.vue', 'app/pages/**/*.vue', 'app/layouts/**/*.vue'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'MemberExpression[property.name="toLocaleString"]',
          message: 'Utilise useMoney() pour formater un montant, jamais toLocaleString.',
        },
      ],
    },
  },
)
