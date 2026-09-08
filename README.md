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
`NUXT_ADMIN_PHONES`, jamais de la base de données.

```bash
# 1. Ton numéro dans .env — plusieurs numéros séparés par des virgules
#    NUXT_ADMIN_PHONES="07 07 12 34 56"

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

| Commande | Effet |
|:--|:--|
| `pnpm dev` | serveur de développement (app membre) |
| `pnpm dev:admin` | back-office, sur le port 3001 |
| `pnpm build` | build de production |
| `pnpm typecheck` | `vue-tsc` sur l'application **et** `tsc` sur `tests/` — doit passer avant tout commit |
| `pnpm lint` / `pnpm lint:fix` | ESLint |
| `pnpm test` | tests unitaires (Vitest) |
| `pnpm test:e2e` | tests de bout en bout (Playwright) |
| `pnpm db:generate` | génère une migration à partir de `server/db/schema.ts` |
| `pnpm db:migrate` | applique les migrations |
| `pnpm db:rollback` | annule la dernière migration |
| `pnpm db:seed` | jeu de développement, rejouable |
| `pnpm db:admin` | crée les comptes des numéros de `NUXT_ADMIN_PHONES` |
| `pnpm build:admin` | build du back-office |
| `pnpm lighthouse` | performance et accessibilité, sur le build |

Avant le premier `pnpm test:e2e`, installer le navigateur :

```bash
pnpm exec playwright install chromium
```

## État

506 tests unitaires, 180 tests de bout en bout à 360 px et 1280 px, budgets de
poids et Lighthouse tenus.

L'interface a été refondue à partir de la maquette de `template/` : en-tête en
dégradé, navigation basse, jauge circulaire, cartes flottantes. Ce qui en a été
écarté l'a été parce que la maquette suit la v1.0 du cahier des charges — score
de confiance, paiement « en 1 clic » — et que le produit ne les tient pas.

L'écran de réglages du président est le seul endroit d'où l'on déclenche la
règle 22 (changement de numéro : notification à tous, gel de 48 h).

La monétisation est livrée : trois paliers forfaitaires — Gratuit, Standard
(7 500 F), Plus (10 000 F) —, la grille publique `/tarifs`, l'écran
`/app/abonnement` et la file de décision du back-office. La grille vit dans
`shared/constants/abonnement.ts`, seule source des prix et des quotas. Deux
choses n'ont pas bougé : l'application **n'encaisse rien** (le règlement se
constate hors application, un administrateur pose le palier), et **aucune
fonction de sécurité n'est derrière le paywall** — registre, preuves, reçus,
contrôle d'intégrité et procès-verbal PDF restent gratuits partout. Les quotas
se vérifient au franchissement, jamais rétroactivement : une tontine en cours
va au bout de son cycle même si son président repasse sous un palier plus
étroit.

Le parcours de l'organisateur est complet de bout en bout : monter et publier
une tontine, accepter ou refuser les demandes d'adhésion, fixer l'ordre de
passage à la main ou au sort, faire sortir un membre en sachant ce qu'il
laisse derrière lui, enregistrer les espèces reçues en main propre,
confirmer, relancer, appliquer une amende, consigner une avance, verser le
pot, clore un tour dont le bénéficiaire ne peut pas accuser réception, et
répondre à une erreur signalée au registre. Une tontine se termine d'elle-même
quand son dernier tour se ferme.

Deux réglages tiennent compte du fait que l'organisateur cumule souvent tous
les rôles : sa propre cotisation est confirmée d'office quand personne d'autre
ne peut la vérifier, et le bénéficiaire d'un tour peut contre-valider le
versement qu'il va recevoir. Les deux sont tracés au registre, et
`docs/data-model.md` §2.4 et §2.5 disent pourquoi.

**Reste ouvert** : `@nuxtjs/i18n` et Vee-Validate sont absents alors que
`CLAUDE.md` les impose ; l'historique factuel du membre n'a ni API ni écran ;
le statut `defaulted` d'un membre ne se pose par aucune interface ; le rail de
paiement de l'abonnement n'est pas choisi — le prélèvement récurrent n'étant
pas garanti ici, le règlement reste manuel.

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
- **Tailwind 4 configuré en CSS** (`@theme`), pas de `tailwind.config.js`.
- **Rendu** : `/` pré-rendue pour le SEO, `/app/**` en SPA (`ssr: false`).
  Aucune page personnalisée n'est rendue côté serveur.
- **Palette en hexadécimal**, jamais en `oklch` : `tests/unit/contraste.spec.ts`
  lit les tokens de `main.css` et calcule le rapport WCAG dessus. Changer une
  couleur sans relancer les tests fait échouer la suite.
- **Un statut ne s'affiche jamais par sa seule couleur** : `shared/constants/statuts.ts`
  impose le triplet mot + icône + couleur, et `<StatusBadge>` rend les trois.
- **Icônes hors ligne** : `@nuxt/icon` en `provider: 'none'`, les icônes sont
  embarquées dans le lot client. Une icône appelée depuis une table de données
  doit être ajoutée à `icon.clientBundle.icons` — un test le vérifie.
- **Tailwind balaie aussi `shared/`** (`@source` dans `main.css`) : la racine
  Vite de Nuxt 4 est `app/`, et les classes des tables de statuts y échapperaient.
- **Aucun frais n'est affiché** : le membre les supporte à l'envoi comme au
  retrait et en connaît l'ordre de grandeur. Aucun taux ne figure donc dans le
  code ni dans la configuration.
- **Base de données** : SQLite en développement via Drizzle. `better-sqlite3`
  n'est importé que dans `server/db/index.ts`, pour que la bascule vers
  Postgres en production ne touche qu'un fichier.
