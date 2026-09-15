# eTontine

Gestion de tontine rotative pour la Côte d'Ivoire. Nuxt 4 fullstack (client +
routes serveur Nitro), PWA mobile-first.

Les règles du projet sont dans [`CLAUDE.md`](./CLAUDE.md). Les spécifications
font foi : [`docs/data-model.md`](./docs/data-model.md) et
[`docs/api-contract.md`](./docs/api-contract.md). Ce sont les deux seules, et
elles sont tenues à jour avec le code — une décision qui s'écarte de ce
qu'elles disent s'y inscrit dans le même commit.

## Démarrer

```bash
corepack enable pnpm     # pnpm 11
pnpm install
cp .env.example .env
pnpm db:migrate
pnpm dev                 # http://localhost:3000
```

### Back-office

Application distincte, sur le port 3001. Le statut d'administrateur vient de
`NUXT\_ADMIN\_PHONES`, jamais de la base de données.

```bash
# 1. Ton numéro dans .env — plusieurs numéros séparés par des virgules
#    NUXT\_ADMIN\_PHONES="07 07 12 34 56"

# 2. Crée le compte correspondant (le back-office n'en crée aucun)
pnpm db:admin

# 3. Lance le back-office
pnpm dev:admin        # http://localhost:3001
```

En développement, le code à usage unique s'affiche directement à l'écran.

`/demo` est la page de vérification du socle : les composants PrimeVue en mode
unstyled habillés par le préréglage pass-through, et les composants de base du
design system avec leurs états.

## Commandes

|Commande|Effet|
|-|-|
|`pnpm dev`|serveur de développement (app membre)|
|`pnpm dev:admin`|back-office, sur le port 3001|
|`pnpm build`|build de production|
|`pnpm typecheck`|`vue-tsc` sur l'application **et** `tsc` sur `tests/` — doit passer avant tout commit|
|`pnpm lint` / `pnpm lint:fix`|ESLint|
|`pnpm test`|tests unitaires (Vitest)|
|`pnpm test:e2e`|tests de bout en bout (Playwright)|
|`pnpm db:generate`|génère une migration à partir de `server/db/schema.ts`|
|`pnpm db:migrate`|applique les migrations|
|`pnpm db:rollback`|annule la dernière migration|
|`pnpm db:seed`|jeu de développement, rejouable|
|`pnpm db:admin`|crée les comptes des numéros de `NUXT\_ADMIN\_PHONES`|
|`pnpm build:admin`|build du back-office|
|`pnpm lighthouse`|performance et accessibilité, sur le build|

Avant le premier `pnpm test:e2e`, installer le navigateur :

```bash
pnpm exec playwright install chromium
```

## Avant la mise en production

Ce qui doit être renseigné ou choisi, et que le code ne peut pas deviner :

|Quoi|Où|
|-|-|
|L'identité de l'éditeur (raison sociale, RCCM, adresse, contact, hébergeur)|`shared/constants/editeur.ts` — les valeurs entre crochets s'affichent telles quelles sur `/legal/*` tant qu'elles ne sont pas complétées|
|L'envoi des codes SMS|`NUXT\_SMS\_PROVIDER=http` avec `NUXT\_SMS\_HTTP\_URL` et `NUXT\_SMS\_HTTP\_TOKEN` ; le mode `log` est refusé en production. Brancher un opérateur précis se fait dans `server/services/sms.ts`|
|Où régler l'abonnement|`NUXT\_PUBLIC\_ABONNEMENT\_REGLEMENT\_*` — le numéro de mobile money, son titulaire et le WhatsApp de contact ; sans eux, l'écran renvoie vers l'adresse de l'éditeur|
|Les notifications push|`NUXT\_VAPID\_*` — facultatives, les notifications restent lisibles dans l'application|
|Le secret de session et l'adresse publique|`NUXT\_SESSION\_SECRET`, `NUXT\_PUBLIC\_SITE\_URL`|

Les chaînes de l'interface vivent dans `i18n/locales/fr.json` ; les mots des
tables partagées (statuts, canaux, rôles) y sont repris et se replient sur
`shared/constants/` s'ils en manquent. La page `/demo` est retirée du build de
production.

## Choix du socle

* **PrimeVue 4 en mode unstyled** : aucun thème PrimeVue n'est chargé, tout le
style vient de Tailwind. Les composants sont déclarés un par un dans
`nuxt.config.ts` (`primevue.components.include`) — jamais `'\*'`, chaque
composant coûte du budget de poids.
* **Le style des composants vit dans `app/primevue/pt.ts`**, un préréglage
pass-through global branché par `importPT`. Un écran n'habille jamais un
composant : corriger l'apparence d'un `Dialog` se fait à un seul endroit.
* **Ordre des couches CSS** déclaré en tête de `app/assets/css/main.css` :
`theme, base, primevue, components, utilities`. Les utilitaires Tailwind
gagnent donc toujours sur PrimeVue, ce qui rend `!important` inutile.
* **Tailwind 4 configuré en CSS** (`@theme`), pas de `tailwind.config.js`.
* **Rendu** : `/` pré-rendue pour le SEO, `/app/\*\*` en SPA (`ssr: false`).
Aucune page personnalisée n'est rendue côté serveur.
* **Palette en hexadécimal**, jamais en `oklch` : `tests/unit/contraste.spec.ts`
lit les tokens de `main.css` et calcule le rapport WCAG dessus. Changer une
couleur sans relancer les tests fait échouer la suite.
* **Un statut ne s'affiche jamais par sa seule couleur** : `shared/constants/statuts.ts`
impose le triplet mot + icône + couleur, et `<StatusBadge>` rend les trois.
* **Icônes hors ligne** : `@nuxt/icon` en `provider: 'none'`, les icônes sont
embarquées dans le lot client. Une icône appelée depuis une table de données
doit être ajoutée à `icon.clientBundle.icons` — un test le vérifie.
* **Tailwind balaie aussi `shared/`** (`@source` dans `main.css`) : la racine
Vite de Nuxt 4 est `app/`, et les classes des tables de statuts y échapperaient.
* **Aucun frais n'est affiché** : le membre les supporte à l'envoi comme au
retrait et en connaît l'ordre de grandeur. Aucun taux ne figure donc dans le
code ni dans la configuration.
* **Base de données** : SQLite en développement via Drizzle. `better-sqlite3`
n'est importé que dans `server/db/index.ts`, pour que la bascule vers
Postgres en production ne touche qu'un fichier.

