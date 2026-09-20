# CLAUDE.md — Règles du projet eTontine

Application de gestion de tontine rotative.
Nuxt 4 fullstack (client + routes serveur Nitro), PWA mobile-first.

\---

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

\---

## Stack — versions imposées, ne pas substituer

|Brique|Version|Note|
|-|-|-|
|Nuxt|4.x|`compatibilityVersion: 4`|
|PrimeVue|4.x|mode **unstyled**, imports explicites composant par composant|
|Tailwind CSS|4.x|config en CSS (`@theme`), **pas** de `tailwind.config.js`|
|`tailwindcss-primeui`|version CSS|`@import "tailwindcss-primeui";`|
|Validation|**Zod** uniquement|schémas dans `shared/schemas/`, partagés client + serveur|
|Formulaires|Vee-Validate + `@vee-validate/zod`||
|État|Pinia + `pinia-plugin-persistedstate`||
|ORM|Drizzle + Postgres|PGlite local en dev (`pnpm db:local`), Supabase en prod|
|Icônes|`@nuxt/icon` en mode **local**|jamais d'appel réseau à l'exécution|
|PWA|`@vite-pwa/nuxt`||
|i18n|`@nuxtjs/i18n`|toutes les chaînes externalisées dès le départ|

Si une bibliothèque supplémentaire semble nécessaire, **demande avant de l'ajouter**.

### Sécurité

* Session par cookie `httpOnly`, `SameSite=Lax`, `Secure`.
* Numéros de téléphone normalisés en E.164 (`+225XXXXXXXXXX`) avant toute persistance.
* **Pas de SMS.** Inscription confirmée par un lien e-mail ; connexion par numéro + code d'accès à 4 chiffres ; « code oublié » par lien e-mail. Le même code protège l'écran de verrouillage.
* Le code d'accès n'a que 10 000 valeurs : compteur d'échecs **en base** (5 échecs → blocage progressif, 10 → compte verrouillé, rouvert seulement par e-mail), limitation par IP en production, réponse identique que le numéro existe ou non.
* Le numéro n'étant plus prouvé, un membre géré qui rejoint par le lien ne fait que **demander** son siège : le président confirme.
* Tout geste sensible — changer de numéro, d'adresse, déclarer un numéro de collecte — redemande le code d'accès. Changement de canal sur une tontine lancée : notification à tous les membres + gel de 48 h.

\---

## Tests

* **Unitaires obligatoires** sur : calcul des dus, calcul des amendes, ordre de rotation avec parts multiples, transitions d'état. Zéro tolérance d'erreur sur ces quatre-là.
* **E2E Playwright** sur les quatre parcours critiques : inscription par e-mail, rejoindre par lien, cotiser (déclarer → confirmer), verser le pot (déclarer → accuser réception).
* Un ticket n'est pas terminé sans ses tests.

\---

