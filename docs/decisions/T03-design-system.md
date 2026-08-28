# T03 — Design system de base

Palette, contrôle de contraste AA et composants de base. Le tableau de
contraste ci-dessous est **calculé sur `app/assets/css/main.css`**, pas recopié
à la main : `tests/unit/contraste.spec.ts` rejoue le même calcul à chaque
`pnpm test` et échoue si une valeur bouge.

---

## 1. Contraste — WCAG 2.1

Seuils appliqués : **4.5:1** pour le texte de taille courante (critère 1.4.3,
niveau AA), **3:1** pour les éléments d'interface porteurs de sens — bordure de
champ, anneau de focus (critère 1.4.11).

| Usage | Encre | Fond | Rapport | Seuil |
|:--|:--|:--|--:|--:|
| Texte courant | `ink` #18181b | `surface` #ffffff | **17.72:1** | 4.5:1 |
| Texte sur fond grisé | `ink` #18181b | `surface-muted` #f4f4f5 | **16.12:1** | 4.5:1 |
| Texte secondaire | `ink-muted` #52525b | `surface` #ffffff | **7.73:1** | 4.5:1 |
| Texte secondaire sur fond grisé | `ink-muted` #52525b | `surface-muted` #f4f4f5 | **7.03:1** | 4.5:1 |
| Texte tertiaire | `ink-subtle` #6d6d76 | `surface` #ffffff | **5.12:1** | 4.5:1 |
| Texte tertiaire sur fond grisé | `ink-subtle` #6d6d76 | `surface-muted` #f4f4f5 | **4.66:1** | 4.5:1 |
| Lien, texte de marque | `brand` #0f6e5c | `surface` #ffffff | **6.17:1** | 4.5:1 |
| Texte sur aplat de marque | `brand-ink` #ffffff | `brand` #0f6e5c | **6.17:1** | 4.5:1 |
| Texte sur aplat foncé | `brand-ink` #ffffff | `brand-strong` #0a4f42 | **9.50:1** | 4.5:1 |
| Badge « À cotiser » | `due-ink` #3f3f46 | `due-surface` #f4f4f5 | **9.50:1** | 4.5:1 |
| Badge « En retard » | `late-ink` #78350f | `late-surface` #fef3c7 | **8.15:1** | 4.5:1 |
| Badge « Déclaré » | `declared-ink` #1e3a8a | `declared-surface` #dbeafe | **8.49:1** | 4.5:1 |
| Badge « Confirmé » | `confirmed-ink` #065f46 | `confirmed-surface` #d1fae5 | **6.78:1** | 4.5:1 |
| Badge « Contesté » | `disputed-ink` #991b1b | `disputed-surface` #fee2e2 | **6.80:1** | 4.5:1 |
| Texte de statut « À cotiser » | `due-ink` #3f3f46 | `surface` #ffffff | **10.44:1** | 4.5:1 |
| Texte de statut « En retard » | `late-ink` #78350f | `surface` #ffffff | **9.07:1** | 4.5:1 |
| Texte de statut « Déclaré » | `declared-ink` #1e3a8a | `surface` #ffffff | **10.36:1** | 4.5:1 |
| Texte de statut « Confirmé » | `confirmed-ink` #065f46 | `surface` #ffffff | **7.68:1** | 4.5:1 |
| Texte de statut « Contesté » | `disputed-ink` #991b1b | `surface` #ffffff | **8.31:1** | 4.5:1 |
| Anneau de focus | `ring` #0f6e5c | `surface` #ffffff | **6.17:1** | 3:1 |
| Anneau de focus sur fond grisé | `ring` #0f6e5c | `surface-muted` #f4f4f5 | **5.61:1** | 3:1 |
| Bordure de champ de saisie | `line-strong` #8b8b96 | `surface` #ffffff | **3.37:1** | 3:1 |

Deux réglages ont été faits pour atteindre le seuil, et ils méritent d'être
connus avant d'y toucher :

- `ink-subtle` est passé de `#71717a` à `#6d6d76`. La valeur d'origine tenait
  sur fond blanc (4.83:1) mais tombait à **4.40:1** sur fond grisé — sous le
  seuil, précisément là où on l'emploie le plus.
- Il a fallu **deux traits distincts**. `--color-line` (`#d4d4d8`) plafonne à
  1.48:1 : c'est un séparateur décoratif, et WCAG ne lui demande rien. Mais la
  bordure d'un champ de saisie délimite la zone où l'on écrit — c'est un
  élément d'interface, il doit atteindre 3:1. D'où `--color-line-strong`
  (`#8b8b96`, 3.37:1), employé par le préréglage PrimeVue pour `InputText` et
  les cases d'`InputOtp`.

Toute la palette est en **hexadécimal**, jamais en `oklch`. Le test lit les
valeurs telles quelles : une conversion intermédiaire ferait reposer la
conformité AA sur l'exactitude de cette conversion plutôt que sur la couleur
livrée. Un test refuse d'ailleurs toute valeur non hexadécimale dans `@theme`,
sinon elle serait silencieusement ignorée par le contrôle — donc jamais
vérifiée.

---

## 2. Règle 10 — jamais la couleur seule

`shared/constants/statuts.ts` est la source unique du triplet **mot + icône +
couleur**, pour les cinq machines à états (cotisation, tour, versement, membre,
tontine). Le type impose les trois attributs : il n'existe pas de statut sans
mot ni sans icône.

Les icônes sont choisies pour se distinguer **par la forme**. Un membre qui ne
perçoit pas la différence entre l'ambre et le vert doit pouvoir lire l'état
d'une cotisation : le triangle d'alerte et la coche ronde ne se confondent pas.
Le procès-verbal photocopié en noir et blanc (T20) reste lisible pour la même
raison.

Trois garde-fous, à trois niveaux :

| Niveau | Ce qui est vérifié |
|:--|:--|
| Compilation | `Record<StatusZodEnum, StatusPresentation>` — un statut ajouté au schéma sans présentation ne compile pas |
| Test unitaire | Chaque table couvre exactement les valeurs de son énumération Zod ; chaque entrée a un mot, une icône et une couleur ; aucun verbe interdit par la règle 8 |
| Test de bout en bout | Les 24 badges rendus sur `/demo` portent tous un `<svg>` **et** un mot non vide, à 360 px comme à 1280 px |

Le bleu de « Déclaré » est vérifié par test : un paiement déclaré n'est pas
confirmé, et le vert le ferait passer pour acquis (T15).

---

## 3. Deux pannes silencieuses évitées

**Les icônes des badges n'étaient pas embarquées.** `@nuxt/icon` tourne en
`provider: 'none'` : aucune requête réseau à l'exécution, donc une icône absente
du paquet client ne s'affiche simplement pas. Or le relevé automatique ne voit
que les `name="…"` écrits en clair dans un gabarit — les noms qui viennent
d'une table lui échappent. Le premier build ne trouvait que **4 icônes sur 20**.
Elles sont désormais listées dans `nuxt.config.ts`, et un test unitaire vérifie
que cette liste reste alignée sur `shared/constants/statuts.ts`.

**Les couleurs de statut ne généraient aucun CSS.** La racine Vite de Nuxt 4 est
`app/` : Tailwind y détecte les classes seul, mais ne regarde jamais `shared/`.
Les badges portaient bien `bg-declared-surface`, sans qu'aucune règle ne la
définisse — badges transparents, sans la moindre erreur au build. Corrigé par
`@source "../../../shared"` dans `main.css`, et le test de bout en bout refuse
désormais un badge dont le fond est `rgba(0, 0, 0, 0)`.

Les deux pannes ont ceci de commun qu'elles ne cassent rien : elles dégradent
l'accessibilité en silence. C'est pourquoi elles sont couvertes par des tests
plutôt que par un commentaire.

---

## 4. Formatage des montants et des dates

`useMoney()` et `useDate()` formatent **à la main**, sans `Intl`. Trois raisons :

1. Le séparateur de milliers de `fr-FR` dépend de la version d'ICU du
   navigateur. Selon l'appareil, `Intl` rend une espace ordinaire, une espace
   insécable ou une espace fine insécable — trois rendus pour un même montant,
   sur un parc dominé par des Android anciens.
2. La règle 6 interdit les flottants. Un formateur qui accepte `25000.5` en
   l'arrondissant masque un bug de calcul en amont ; `useMoney()` lève.
3. Le rendu doit être identique côté serveur, dans le procès-verbal PDF (T20),
   et côté client.

Le test d'acceptation vérifie la suite exacte de points de code :
`25` · **U+202F** · `000` · **U+00A0** · `FCFA`.

> **Point à confirmer.** La règle 7 impose l'espace fine insécable (U+202F)
> comme *séparateur de milliers* — c'est fait. Elle ne dit rien de l'espace
> entre le nombre et `FCFA` : les exemples de `CLAUDE.md` et du backlog sont
> écrits avec des espaces ordinaires, qui ne peuvent pas faire foi. J'ai retenu
> **U+00A0**, conforme à l'usage français et à CLDR pour une unité monétaire.
> À trancher avant que des montants partent dans des documents signés.

---

## 5. Poids

| Page | Fichiers bloquants | Avant T03 | Après T03 |
|:--|--:|--:|--:|
| `/` (landing, aucune icône) | 8 | 88,9 Ko | **101,3 Ko** |
| `/demo` | 24 | 126,7 Ko | **153,6 Ko** |

Les 20 icônes pèsent 6,1 Ko non compressés. L'essentiel des 12 Ko ajoutés à la
landing vient du runtime de `@nuxt/icon` et d'Iconify, qui atterrissent dans le
morceau d'entrée parce que `<Icon>` est un composant global.

La landing paie donc pour un système qu'elle n'utilise pas. C'est mutualisé —
le morceau d'entrée est partagé et mis en cache pour toute l'application — et
l'on reste à 101 Ko contre un plafond de 180 Ko. À réexaminer en T25 si les
budgets se resserrent, pas avant.
