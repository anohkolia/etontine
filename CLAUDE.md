# CLAUDE.md — Règles du projet eTontine

Application de gestion de tontine rotative pour la Côte d'Ivoire.
Nuxt 4 fullstack (client + routes serveur Nitro), PWA mobile-first.

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

Si une bibliothèque supplémentaire semble nécessaire, **demande avant de l'ajouter**.

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

---

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

## Style de travail attendu

1. Avant d'écrire du code sur un ticket, **propose un plan court** (fichiers touchés, approche) et attends la validation.
2. Un ticket = un commit cohérent. Message en français, impératif.
3. Après chaque ticket : `pnpm typecheck && pnpm lint && pnpm test` doivent passer.
4. Si une spec de `docs/` est ambiguë ou contradictoire, **signale-le** au lieu de choisir.
