# T02 — Intégration PrimeVue 4 unstyled / Tailwind 4

Capture de l'ordre des couches CSS et des décisions prises, demandée en
acceptation du ticket T02 de `docs/backlog.md`.

---

## 1. Ordre des couches

Déclaré en tête de `app/assets/css/main.css`, **avant tout `@import`** :

```css
@layer theme, base, primevue, components, utilities;

@import "tailwindcss";
@import "tailwindcss-primeui";
```

La première déclaration `@layer` d'une feuille fixe la priorité pour toute la
suite. Placée après un `@import`, elle serait sans effet : c'est celle de
Tailwind qui l'emporterait.

Ordre réellement appliqué, relevé dans le CSSOM du navigateur :

```
properties          ← émise par Tailwind 4 (@property de repli)
theme               ← tokens @theme
base                ← preflight Tailwind + nos règles de base
primevue            ← réservée, vide en mode unstyled
components
utilities           ← les utilitaires Tailwind, en dernier
hors couche         ← .p-hidden-accessible, .p-overflow-hidden (PrimeVue)
```

**Conséquence recherchée :** `utilities` passe après `primevue`, donc un
utilitaire Tailwind l'emporte toujours sur une règle PrimeVue. C'est ce qui
rend `!important` inutile — et c'est vérifié par test, pas par relecture :

- `tests/unit/css-couches.spec.ts` — la déclaration précède les `@import`,
  l'ordre est exactement celui attendu, aucun `!important` dans nos sources.
- `tests/e2e/demo.spec.ts` — l'ordre est relu dans le CSSOM du navigateur, et
  aucune règle `!important` ne provient de nos feuilles.

Le seul `!important` du CSS livré vient du preflight de Tailwind
(`[hidden]:where(:not([hidden="until-found"]))`), en amont de nous.

---

## 2. La couche `primevue` est vide, et c'est normal

En mode unstyled, PrimeVue n'émet aucun CSS de thème : il rend la structure et
le comportement, le style vient entièrement des utilitaires Tailwind posés par
le préréglage pass-through. La couche est déclarée pour réserver
l'emplacement — si l'on quittait un jour le mode unstyled, le thème s'y
insérerait sans rien réordonner.

**Deux règles restent hors couche**, injectées dans le `<head>` par PrimeVue :

```css
.p-hidden-accessible { position: absolute; width: 1px; height: 1px; /* … */ }
.p-overflow-hidden   { overflow: hidden; padding-right: var(--p-scrollbar-width); }
```

Hors couche, elles battent n'importe quel utilitaire. **C'est le comportement
souhaitable** : la première masque un élément à l'écran tout en le laissant aux
lecteurs d'écran, la seconde bloque le défilement de la page derrière une boîte
modale. Aucune des deux ne doit pouvoir être écrasée par un utilitaire de
passage, et Tailwind ne génère pas ces deux noms — aucune collision possible.

> **Piste explorée puis abandonnée.** Le module expose `loadStyles: false`, qui
> coupe cette injection et nous rendrait maîtres des deux règles. Mesuré des
> deux côtés : **coût bloquant identique à l'octet près** sur `/` comme sur
> `/demo`. Le gain supposé n'existe pas — les modules de style sont regroupés
> avec leurs composants et suivent déjà le découpage par page. On garde le
> défaut du module : une recopie à maintenir en moins.

---

## 3. Où vit le style des composants

Un seul fichier : `app/primevue/pt.ts`, branché par `importPT` dans
`nuxt.config.ts`. Chaque section pass-through y reçoit ses utilitaires
Tailwind.

Un écran n'habille jamais un composant. `<Dialog>` s'écrit sans une classe :

```vue
<Dialog v-model:visible="open" modal header="As-tu envoyé ?">…</Dialog>
```

Corriger l'apparence d'un composant se fait donc à un seul endroit, pour toute
l'application. Les noms de sections (`root`, `mask`, `pcCloseButton`…) viennent
des types de PrimeVue 4.5 : une section mal nommée est ignorée **en silence**,
d'où les assertions de classes dans les tests de bout en bout.

Le préréglage tient la **structure** : surfaces, bordures, rayons, espacements,
anneau de focus, cibles tactiles. La palette de couleurs métier et son contrôle
de contraste AA restent le ticket T03 ; un test refuse toute couleur littérale
dans le préréglage pour que T03 n'ait pas à repasser sur chaque composant.

---

## 4. Tokens `@theme` posés

Configuration en CSS, pas de `tailwind.config.js`.

| Token | Valeur | Utilitaires générés |
|:--|:--|:--|
| `--spacing-touch` | `2.75rem` | `min-h-touch`, `size-touch` — règle 13, cible tactile de 44 px |
| `--color-surface` | `#fff` | `bg-surface` |
| `--color-surface-muted` | `oklch(97% 0 0)` | `bg-surface-muted` |
| `--color-line` | `oklch(92.2% 0 0)` | `border-line` |
| `--color-ring` | `oklch(55.6% 0 0)` | `ring-ring` |
| `--radius-control` | `0.5rem` | `rounded-control` |
| `--radius-card` | `0.75rem` | `rounded-card`, `rounded-t-card` |
| `--font-sans` | `system-ui, …` | règle 16, aucune police téléchargée |

Ces tokens sont **structurels** : ils disent « fond de carte » ou
« séparateur », jamais « vert » ni « rouge ».

---

## 5. Poids

Coût **bloquant** du premier rendu — `modulepreload` + feuilles de style,
compressé. Les `prefetch` sont exclus : ils partent au repos, après le rendu.

| Page | Fichiers bloquants | Poids |
|:--|--:|--:|
| `/` (pré-rendue, aucun composant PrimeVue) | 4 | **89,0 Ko** |
| `/demo` (les huit composants) | 19 | **126,7 Ko** |

Budgets de CLAUDE.md : JS initial < 180 Ko, premier chargement < 250 Ko hors
images. Les deux pages passent. `/demo` n'est qu'une page de vérification :
aucun écran métier ne chargera les huit composants à la fois.

Les douze composants déclarés (`Stepper` en compte cinq à lui seul) ne pèsent
que sur les pages qui les utilisent — vérifié : le morceau de `/demo` est le
seul à importer les composants, `/` ne les reçoit qu'en `prefetch`.

---

## 6. Décision de conception prise en cours de route

Le préréglage masquait initialement le libellé des étapes du `Stepper` sous le
point de rupture `sm`. À 360 px, le wizard se réduisait à trois numéros nus —
illisible pour le parcours de création de tontine (T10, cinq étapes). Le
libellé est désormais visible à toutes les largeurs, simplement plus compact.
Le test de bout en bout à 360 px l'a révélé avant la revue.
