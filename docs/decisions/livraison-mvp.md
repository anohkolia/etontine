# Livraison du MVP — T01 à T27

État à la fin du backlog. Ce document dit ce qui est livré, ce qui a été
tranché en cours de route, et ce qui reste ouvert.

---

## 1. Ce qui est vérifié

| Contrôle | Résultat |
|:--|:--|
| `pnpm typecheck` | vue-tsc sur l'application **et** `tsc` sur `tests/` |
| `pnpm lint` | ESLint, zéro avertissement |
| `pnpm test` | **370 tests unitaires** |
| `pnpm test:e2e` | **120 tests de bout en bout**, à 360 px et 1280 px |
| `pnpm build` | échoue de lui-même si un budget est dépassé ou si une bibliothèque serveur bascule dans le lot client |
| `pnpm lighthouse` | 100 partout sur `/`, `/aide` et `/login` |

Poids mesurés sur le build, compressés :

| Mesure | Relevé | Budget |
|:--|--:|--:|
| JS initial | 110,4 Ko | 180 Ko |
| Premier chargement | 117,7 Ko | 250 Ko |
| Navigation la plus lourde | 10,1 Ko | 40 Ko |

---

## 2. Décisions prises et validées

| Sujet | Choix retenu |
|:--|:--|
| Espace avant `FCFA` | U+00A0, U+202F restant le séparateur de milliers |
| Palier KYC de création | Brouillon privé au palier 1, **publication** au palier 2 |
| Revue d'identité | Approbation immédiate hors production, `pending_review` en production |
| Style PrimeVue | Préréglage pass-through global, jamais au point d'appel |
| Non-régression visuelle | Assertions structurelles, pas de captures de référence |
| Bibliothèques serveur | `qrcode`, `pdfkit`, `exceljs`, `web-push` — aucune dans le lot client |

---

## 3. Écarts assumés, à reporter dans les spécifications

**Deux types d'écriture ajoutés au registre.** `declaration_escalated` et
`cash_unconfirmed`. L'acceptation de T17 exige que ces alertes soient
« visibles de tous au registre », et aucun type de `docs/data-model.md` §1 ne
dit cela sans mentir sur la nature du fait.

**Une colonne dénormalisée.** `shares.tontine_id` se déduirait de
`membership_id`, mais SQLite ne sait pas poser une contrainte d'unicité à
travers une jointure — et l'unicité de `(tontine_id, rotation_position)` est
exigée par T04. C'est le prix d'une garantie tenue par la base plutôt que par
du code.

**Le président reçoit une part à la création.** Absent des spécifications, mais
sans elle l'organisateur serait membre sans jamais cotiser ni prendre la main :
le pot attendu serait sous-évalué et la phrase d'engagement annoncerait un
cycle plus court que la réalité.

**Le wizard compte six écrans, pas cinq.** `docs/backlog.md` parle de cinq
étapes, `docs/cahier-des-charges.md` en détaille six (l'étape 0 « type
d'accès » précède les cinq autres). La spécification détaillée a été suivie.

---

## 4. Ce qui n'est pas livré, et pourquoi

**`/tarifs` et `/legal/*`.** Ces pages figurent dans la cartographie des routes,
mais leur contenu dépend de deux points que `CLAUDE.md` interdit de trancher
seul : le modèle de monétisation et la formulation des CGU. Aucune page n'y
renvoie ; les créer avec un contenu inventé serait pire que leur absence.

**Un back-office de revue d'identité.** Hors périmètre MVP par la
spécification. Conséquence assumée : en production, aucune tontine ne peut être
publiée tant qu'un moyen d'approuver les dossiers n'existe pas.

**L'envoi effectif des SMS et des appels vocaux.** Aucun opérateur n'est
branché. Le point d'entrée est unique (`server/services/otp.ts`, fonction
`livrerCode`) pour que le branchement ne touche qu'une fonction. Hors
production, le code s'affiche à l'écran.

**Les clés VAPID.** Le push est configuré mais inerte sans
`NUXT_VAPID_PUBLIC_KEY` et `NUXT_VAPID_PRIVATE_KEY`. Les notifications restent
enregistrées et consultables dans l'application : faire échouer une
confirmation de cotisation parce qu'une clé manque serait absurde.

**Le reçu image est un SVG.** Quelques kilo-octets, net à toutes les tailles,
très en dessous des 40 Ko exigés. Un rendu matriciel — utile pour l'aperçu
WhatsApp en ligne — demanderait un moteur de rendu supplémentaire.

---

## 5. Valeurs de configuration à renseigner avant la production

Aucune n'est codée en dur ; toutes attendent une décision ou un back-office.

| Réglage | Où | Aujourd'hui |
|:--|:--|:--|
| Barème des frais par opérateur | `runtimeConfig.fees` | `configured: false` — l'interface annonce l'existence des frais sans avancer de chiffre |
| Seuil d'alerte de plafond de portefeuille | `runtimeConfig.public.potAlertThreshold` | 500 000 FCFA |
| Seuil de contre-validation d'un versement | colonne `tontines.counter_validation_threshold` | 100 000 FCFA, par tontine |
| Secret de session | `NUXT_SESSION_SECRET` | valeur de développement, à remplacer |

---

## 6. Invariants tenus par des tests, pas par la vigilance

Ces contrôles échouent si quelqu'un contourne une règle, y compris de bonne foi :

- **Registre append-only** — aucune route de modification, et surtout : rien
  hors de `services/ledger.ts` n'écrit dans `ledger_entries`. Le contrôle porte
  sur l'invariant, pas sur les noms de fichiers.
- **Aucun montant en notification** (règle 21) — le filtre est appliqué à
  l'écriture, au seul endroit où les notifications naissent.
- **Contraste AA** — 22 paires calculées sur les tokens réels de `main.css`.
- **Aucune bibliothèque serveur dans le lot client** (règle 17) — vérifié sur
  le build, avec les budgets de poids.
- **Les cinq états d'écran** — chaque page déclare les cinq, et justifie ceux
  qui sont sans objet.
- **Migrations réversibles** — un cycle montée → descente → montée doit rendre
  un schéma identique, et le nombre de tables est dérivé du schéma.
