# CLAUDE.md — Règles du projet Tontine CI

Application de gestion de tontine rotative pour la Côte d'Ivoire.
Nuxt 4 fullstack (client + routes serveur Nitro), PWA mobile-first.

**Lis `docs/data-model.md` et `docs/api-contract.md` avant d'écrire du code.**
**Prends les tickets dans l'ordre de `docs/backlog.md`. Un ticket à la fois.**

---

## Commandes

```bash
pnpm dev            # dev server
pnpm build          # build production
pnpm typecheck      # vue-tsc — DOIT passer avant tout commit
pnpm lint           # eslint
pnpm test           # vitest (unitaires)
pnpm test:e2e       # playwright
pnpm db:migrate     # migrations drizzle
```

---

## Stack — versions imposées, ne pas substituer

| Brique | Version | Note |
|:--|:--|:--|
| Nuxt | 4.x | `compatibilityVersion: 4` |
| PrimeVue | 4.x | mode **unstyled**, imports explicites composant par composant |
| Tailwind CSS | 4.x | config en CSS (`@theme`), **pas** de `tailwind.config.js` |
| `tailwindcss-primeui` | version CSS | `@import "tailwindcss-primeui";` |
| Validation | **Zod** uniquement | schémas dans `shared/schemas/`, partagés client + serveur |
| Formulaires | Vee-Validate + `@vee-validate/zod` | |
| État | Pinia + `pinia-plugin-persistedstate` | |
| ORM | Drizzle + SQLite (dev) / Postgres (prod) | |
| Icônes | `@nuxt/icon` en mode **local** | jamais d'appel réseau à l'exécution |
| PWA | `@vite-pwa/nuxt` | |
| i18n | `@nuxtjs/i18n` | toutes les chaînes externalisées dès le départ |

Si une bibliothèque supplémentaire semble nécessaire, **demande avant de l'ajouter**. Chaque dépendance client coûte du budget de poids (voir plus bas).

---

## Architecture

```
app/
  components/       # composants Vue, PascalCase, un dossier par domaine
  composables/      # useMoney, useTontine, useAuth...
  pages/            # routes (voir docs/api-contract.md §Routes)
  middleware/       # auth, role, kyc-palier
  stores/           # Pinia
server/
  api/v1/           # routes Nitro
  services/         # logique métier — les transitions d'état vivent ICI
  db/               # schéma drizzle + migrations
  utils/            # ledger, idempotency, auth
shared/
  schemas/          # Zod, importés des deux côtés
  constants/        # statuts, rôles, canaux
docs/               # spécifications
```

**Rendu :** `/` pré-rendue (SEO). Application authentifiée en SPA (`routeRules: { '/app/**': { ssr: false } }`). Ne pas faire de SSR sur des pages personnalisées.

---

## Règles non négociables

### Autorité serveur
1. **Aucune transition d'état ne se décide côté client.** Le client envoie une intention (`POST /contributions/:id/declare`), le serveur valide la transition contre la machine à états et le rôle de l'appelant. Un client qui envoie `status: "confirmed"` reçoit un 400.
2. **Tous les montants sont calculés côté serveur.** Le client affiche, il ne calcule jamais un dû, une amende ou un total de pot.
3. **Écritures de registre append-only.** Aucune route `PUT`/`DELETE` sur `ledger_entries`. Une correction est une nouvelle écriture d'annulation, elle-même tracée.
4. **Idempotence obligatoire** sur toute création liée à l'argent : header `Idempotency-Key`, rejeu = même réponse, pas de doublon.

### Argent
5. **L'application ne détient jamais de fonds.** Pas de solde, pas de portefeuille, pas de compte. Le membre envoie directement sur le canal de collecte de l'organisateur, puis **déclare**.
6. **Montants en entiers, en FCFA, jamais en flottant.** Pas de centimes. Type `number` entier partout, colonne `integer` en base.
7. **Format d'affichage imposé** : `25 000 FCFA` — espace fine insécable (`\u202F`) comme séparateur de milliers, zéro décimale, suffixe `FCFA`. Utilise **toujours** `useMoney()`, jamais `toLocaleString` directement dans un composant.

### Vocabulaire d'interface
8. Verbes autorisés : déclarer, confirmer, enregistrer, justifier, rapprocher.
   Verbes **interdits dans l'UI** : encaisser, créditer, débiter, reverser, transférer, solde, portefeuille.
9. Termes métier à utiliser : « prendre la main » (recevoir le pot), « cotisation », « tour », « amende », « le président », « le trésorier ». Ne pas écrire « ramassage », « bénéficiaire du décaissement », « échéance ».

### UI
10. **Jamais d'information portée par la couleur seule** : toujours couleur + icône + mot.
11. **Pas de `DataTable` sous le breakpoint `md`.** Liste de cartes empilées sur mobile.
12. **Pas de `localStorage` pour des données financières.** Pinia persisté = cache d'affichage uniquement, jamais source de vérité.
13. Cibles tactiles ≥ 44×44 px. Taille de texte de base 16 px. Actions primaires en bas d'écran.
14. Chaque écran implémente **cinq états** : chargement (squelette), vide, erreur, hors-ligne, contenu. Un écran livré sans ses états est un écran incomplet.

### Performance — budgets appliqués en CI
15. JS initial compressé **< 180 Ko**. Premier chargement total **< 250 Ko** hors images. Navigation ultérieure **< 40 Ko**.
16. Police **système** (`system-ui`). Aucune police téléchargée.
17. Génération PDF et Excel **côté serveur** (Nitro). Ne jamais embarquer `jsPDF` ou `xlsx` dans le bundle client.
18. Images uploadées (captures de paiement) compressées **côté client à < 100 Ko** avant envoi.

### Sécurité
19. Session par cookie `httpOnly`, `SameSite=Lax`, `Secure`.
20. Numéros de téléphone normalisés en E.164 (`+225XXXXXXXXXX`) avant toute persistance.
21. Les notifications ne contiennent **jamais de montant** (écran de verrouillage, téléphone partagé). « Nouvelle activité sur ta tontine », pas « Tu as reçu 250 000 FCFA ».
22. Tout changement de canal de collecte d'un organisateur : re-vérification OTP + notification à tous les membres + gel de 48 h.

---

## Tests

- **Unitaires obligatoires** sur : calcul des dus, calcul des amendes, ordre de rotation avec parts multiples, transitions d'état. Zéro tolérance d'erreur sur ces quatre-là.
- **E2E Playwright** sur les quatre parcours critiques : inscription OTP, rejoindre par lien, cotiser (déclarer → confirmer), verser le pot (déclarer → accuser réception).
- Un ticket n'est pas terminé sans ses tests.

---

## Ce que tu ne dois pas décider seul

Ces points ne sont pas tranchés. Si un ticket semble en dépendre, **arrête-toi et demande** :

- Modèle de monétisation (abonnement / frais de service / freemium)
- Visibilité du score de confiance
- Plafonds de montant pour les tontines ouvertes
- Formulation exacte des CGU et mentions légales

N'invente pas de valeur par défaut « raisonnable » sur ces sujets. Une hypothèse silencieuse ici coûte une refonte.

---

## Style de travail attendu

1. Avant d'écrire du code sur un ticket, **propose un plan court** (fichiers touchés, approche) et attends la validation.
2. Un ticket = un commit cohérent. Message en français, impératif.
3. Après chaque ticket : `pnpm typecheck && pnpm lint && pnpm test` doivent passer.
4. Si une spec de `docs/` est ambiguë ou contradictoire, **signale-le** au lieu de choisir.
