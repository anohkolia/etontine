# Tontine CI

Gestion de tontine rotative pour la Côte d'Ivoire. Nuxt 4 fullstack (client +
routes serveur Nitro), PWA mobile-first.

Les règles du projet sont dans [`CLAUDE.md`](./CLAUDE.md). Les spécifications
font foi : [`docs/data-model.md`](./docs/data-model.md),
[`docs/api-contract.md`](./docs/api-contract.md),
[`docs/backlog.md`](./docs/backlog.md).

## Démarrer

```bash
corepack enable pnpm     # pnpm 11
pnpm install
cp .env.example .env
pnpm db:migrate
pnpm dev                 # http://localhost:3000
```

`/demo` est la page de vérification du socle : les composants PrimeVue en mode
unstyled habillés par le préréglage pass-through, et les composants de base du
design system avec leurs états.

## Commandes

| Commande | Effet |
|:--|:--|
| `pnpm dev` | serveur de développement |
| `pnpm build` | build de production |
| `pnpm typecheck` | `vue-tsc` sur l'application **et** `tsc` sur `tests/` — doit passer avant tout commit |
| `pnpm lint` / `pnpm lint:fix` | ESLint |
| `pnpm test` | tests unitaires (Vitest) |
| `pnpm test:e2e` | tests de bout en bout (Playwright) |
| `pnpm db:generate` | génère une migration à partir de `server/db/schema.ts` |
| `pnpm db:migrate` | applique les migrations |
| `pnpm db:rollback` | annule la dernière migration |
| `pnpm db:seed` | jeu de développement, rejouable |
| `pnpm lighthouse` | performance et accessibilité, sur le build |

Avant le premier `pnpm test:e2e`, installer le navigateur :

```bash
pnpm exec playwright install chromium
```

## État

Les 27 tickets de [`docs/backlog.md`](./docs/backlog.md) sont livrés.
370 tests unitaires, 120 tests de bout en bout à 360 px et 1280 px, budgets de
poids et Lighthouse tenus. Bilan, écarts assumés et réglages à renseigner avant
la production : [`docs/decisions/livraison-mvp.md`](./docs/decisions/livraison-mvp.md).

## Choix du socle

- **PrimeVue 4 en mode unstyled** : aucun thème PrimeVue n'est chargé, tout le
  style vient de Tailwind. Les composants sont déclarés un par un dans
  `nuxt.config.ts` (`primevue.components.include`) — jamais `'*'`, chaque
  composant coûte du budget de poids.
- **Le style des composants vit dans `app/primevue/pt.ts`**, un préréglage
  pass-through global branché par `importPT`. Un écran n'habille jamais un
  composant : corriger l'apparence d'un `Dialog` se fait à un seul endroit.
- **Ordre des couches CSS** déclaré en tête de `app/assets/css/main.css` :
  `theme, base, primevue, components, utilities`. Les utilitaires Tailwind
  gagnent donc toujours sur PrimeVue, ce qui rend `!important` inutile.
  Détail et mesures : [`docs/decisions/T02-couches-css.md`](./docs/decisions/T02-couches-css.md).
- **Tailwind 4 configuré en CSS** (`@theme`), pas de `tailwind.config.js`.
- **Rendu** : `/` pré-rendue pour le SEO, `/app/**` en SPA (`ssr: false`).
  Aucune page personnalisée n'est rendue côté serveur.
- **Palette en hexadécimal**, jamais en `oklch` : `tests/unit/contraste.spec.ts`
  lit les tokens de `main.css` et calcule le rapport WCAG dessus. Changer une
  couleur sans relancer les tests fait échouer la suite.
  Détail : [`docs/decisions/T03-design-system.md`](./docs/decisions/T03-design-system.md).
- **Un statut ne s'affiche jamais par sa seule couleur** : `shared/constants/statuts.ts`
  impose le triplet mot + icône + couleur, et `<StatusBadge>` rend les trois.
- **Icônes hors ligne** : `@nuxt/icon` en `provider: 'none'`, les icônes sont
  embarquées dans le lot client. Une icône appelée depuis une table de données
  doit être ajoutée à `icon.clientBundle.icons` — un test le vérifie.
- **Tailwind balaie aussi `shared/`** (`@source` dans `main.css`) : la racine
  Vite de Nuxt 4 est `app/`, et les classes des tables de statuts y échapperaient.
- **Base de données** : SQLite en développement via Drizzle. `better-sqlite3`
  n'est importé que dans `server/db/index.ts`, pour que la bascule vers
  Postgres en production ne touche qu'un fichier.
