import { fileURLToPath } from 'node:url'
import { defineVitestConfig } from '@nuxt/test-utils/config'

export default defineVitestConfig({
  test: {
    // Les tests unitaires (calcul des dus, amendes, rotation, transitions)
    // tournent en environnement Node ; un test a besoin du DOM le déclare
    // avec `// @vitest-environment nuxt` en tête de fichier.
    environment: 'node',
    include: ['tests/unit/**/*.spec.ts'],
    globals: true,
    // Par défaut vitest lance (CPU − 1) forks, soit 11 ici, à ~700 Mo chacun :
    // la VM WSL (8 Go) part en OOM et la session est tuée. 4 suffisent.
    maxWorkers: 4,
  },
  resolve: {
    alias: {
      '#shared': fileURLToPath(new URL('./shared', import.meta.url)),
      '~~': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
})
