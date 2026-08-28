# Backlog d'implémentation

Tickets dans l'ordre. **Un ticket à la fois.** Chaque ticket commence par un plan court soumis à validation, et se termine par `pnpm typecheck && pnpm lint && pnpm test` au vert.

Légende : 🔴 bloquant pour la suite · 🟡 parallélisable

---

## Phase 0 — Fondations

### T01 🔴 Scaffolding
Nuxt 4, TypeScript strict, PrimeVue 4 unstyled, Tailwind 4, ESLint, Vitest, Playwright, Drizzle + SQLite.

**Acceptation** — `pnpm dev` démarre ; une page de test affiche un `Button` PrimeVue stylé par Tailwind sans conflit ; `pnpm typecheck` passe.

### T02 🔴 Intégration PrimeVue 4 / Tailwind 4
Ordre des couches CSS, `tailwindcss-primeui` version CSS, tokens de `@theme`, mode unstyled.

**Acceptation** — capture de l'ordre des couches dans le PR ; page de démonstration avec 8 composants (`Button`, `InputText`, `InputOtp`, `Dialog`, `Card`, `Tag`, `ProgressBar`, `Stepper`) sans régression visuelle ; aucun `!important`.

### T03 🔴 Design system de base
Tokens couleurs (contraste AA vérifié), `useMoney()`, `useDate()`, composants `<StatusBadge>` (couleur + icône + mot), `<AmountDisplay>`, `<EmptyState>`, `<ErrorState>`, `<LoadingSkeleton>`, `<OfflineBanner>`.

**Acceptation** — test unitaire de `useMoney()` : `25000 → "25 000 FCFA"` avec espace fine insécable, `0 → "0 FCFA"`, refus d'un non-entier ; contraste AA validé sur toute la palette ; `<StatusBadge>` ne rend jamais la couleur seule.

### T04 🔴 Schéma de base et migrations
Toutes les tables de `docs/data-model.md`, plus `idempotency_keys`. Seed de développement : 1 tontine de 6 membres dont un à double part, 3 tours, statuts variés.

**Acceptation** — migrations réversibles ; seed rejouable ; contrainte d'unicité sur `shares(tontine_id, rotation_position)`.

### T05 🔴 Socle serveur
Middleware de session, résolution du rôle **par tontine**, format d'erreur unique, middleware d'idempotence, helper `assertTransition()` lisant les tables de `shared/schemas`.

**Acceptation** — un test prouve qu'une transition interdite renvoie `409 INVALID_TRANSITION` ; un test prouve que le rejeu d'une `Idempotency-Key` ne crée pas de second enregistrement.

### T06 🔴 Registre append-only
`ledger_entries` avec chaînage de hachage par tontine, service `appendLedger()`, endpoint de vérification.

**Acceptation** — aucune route d'écriture ou de suppression sur le registre ; test : altérer une écriture en base fait échouer `/ledger/verify` en indiquant la position ; l'horodatage vient du serveur, pas du payload client.

---

## Phase 1 — Entrer dans l'application

### T07 🔴 Authentification OTP
Demande, vérification, session, renvoi après 30 s, fallback vocal après 2 échecs, rate limiting.

**Acceptation** — masque de saisie `XX XX XX XX XX` ; normalisation E.164 vérifiée par test sur `0707123456`, `+2250707123456`, `07 07 12 34 56` ; `autocomplete="one-time-code"` présent ; une réponse identique que le numéro existe ou non.

### T08 🟡 Profil, PIN, consentements
Profil minimal, verrouillage PIN, écrans de consentement granulaire, `/app/profil/donnees` (export + suppression).

**Acceptation** — la suppression refusée liste les tours en cours qui bloquent ; consentement données et consentement notifications sont deux cases distinctes.

### T09 🔴 Canaux de collecte
CRUD + vérification OTP du numéro de collecte. `holderName` obligatoire.

**Acceptation** — un canal non vérifié ne peut pas être rattaché à une tontine ; modifier un canal d'une tontine active déclenche notification à tous les membres et gel de 48 h (test).

---

## Phase 2 — Créer et rejoindre

### T10 🔴 Wizard de création
5 étapes, brouillon sauvegardé à chaque étape, simulateur en direct, alerte de plafond de portefeuille.

**Acceptation** — fermer et rouvrir l'application restaure le brouillon à la bonne étape ; le simulateur affiche « 12 × 10 000 = 120 000 FCFA par tour, sur 12 mois » et se met à jour à chaque frappe ; l'option « tontine ouverte » est visible mais grisée si KYC < 2, avec l'explication.

### T11 🔴 Membres, parts et rotation
Ajout de membres gérés, attribution des parts, ordre fixe ou tirage serveur, démarrage de la tontine.

**Acceptation** — **test central** : un membre à 2 parts occupe 2 positions distinctes, apparaît 2 fois dans la rotation et génère 2 contributions par tour ; le tirage écrit graine et résultat au registre ; après `start`, l'ordre n'est plus modifiable sans contre-validation.

### T12 🔴 Invitation et adhésion
`/join/[token]` consultable **sans être connecté**, écran de récapitulatif d'engagement, message WhatsApp pré-rempli, QR code, confirmation SMS du membre géré.

**Acceptation** — un visiteur non connecté voit nom, président, montant, fréquence, nb de membres ; la phrase d'engagement est générée dynamiquement (« Tu t'engages à verser X chaque mois pendant N mois, soit Y au total. Tu recevras Y à ton tour. ») ; un membre géré qui confirme son lien est rattaché **sans duplication d'historique**.

---

## Phase 3 — Le cœur : cotiser

### T13 🔴 Génération des tours et des contributions
Au démarrage, création de tous les `rounds` et `contributions`. Tâches `mark-late` et `open-next-round`.

**Acceptation** — le bénéficiaire du tour a lui aussi une contribution ; `expected_amount = shareAmount × totalShares` ; test des dates d'échéance sur les 4 fréquences.

### T14 🔴 Écran « où envoyer »
Montant + frais, canal, numéro en gros avec bouton Copier, **nom du titulaire affiché**, référence courte, bouton Ouvrir Wave, sélecteur si plusieurs canaux.

**Acceptation** — les frais viennent du back-office, **aucun taux codé en dur** ; le bouton Copier fonctionne sans HTTPS local cassé ; le nom du titulaire est toujours visible.

### T15 🔴 Déclaration de paiement
Écran « As-tu envoyé ? », formulaire de déclaration, compression d'image côté client, garde-fou anti-double-déclaration.

**Acceptation** — une image de 4 Mo est compressée sous 100 Ko avant envoi (test) ; le bouton reste inactif 90 s après un envoi ; une seconde déclaration sur le même tour affiche un message explicite au lieu d'un doublon silencieux ; le statut affiché est **bleu « Déclaré »**, jamais vert.

### T16 🔴 File de confirmation du trésorier
Liste de cartes, confirmer / rejeter avec motif, « tout confirmer », déclaration d'espèces pour un tiers.

**Acceptation** — un utilisateur ne peut pas confirmer sa propre déclaration (test serveur, 403) ; un rejet sans motif est refusé ; la confirmation génère une écriture au registre et notifie le membre ; « tout confirmer » est idempotent.

### T17 🔴 Escalade et confirmation inverse
Tâches `escalate-declarations` (48 h) et `unconfirmed-cash` (72 h).

**Acceptation** — après 48 h simulées, la déclaration est marquée escaladée, le bureau est notifié et l'alerte est **visible de tous** au registre.

### T18 🟡 Reçus
Reçu image < 40 Ko, page publique `/recu/[id]` avec lien signé.

**Acceptation** — poids vérifié en test ; le lien signé expire ; la page ne divulgue que montant, date, tontine, membre — pas la liste des autres membres.

---

## Phase 4 — Verser le pot

### T19 🔴 Versement complet
Préparation, ressaisie des 4 derniers chiffres, contre-validation au-delà du seuil, déclaration, accusé de réception du bénéficiaire, clôture du tour.

**Acceptation** — seul le bénéficiaire peut accuser réception (403 sinon) ; le tour ne se clôt pas sans accusé ; forcer un versement sur pot incomplet écrit le montant manquant au registre ; alerte affichée si le numéro du bénéficiaire a changé il y a moins de 48 h.

---

## Phase 5 — Consulter et relancer

### T20 🔴 Registre et exports
Registre lisible par tout membre, filtres, export PDF (procès-verbal A4) et Excel **côté serveur**.

**Acceptation** — aucune dépendance PDF/Excel dans le bundle client (vérifié par analyse du bundle) ; le PV contient la liste des cotisations du tour, le versement et un emplacement de signature.

### T21 🔴 Tableau de bord
Bloc « à traiter aujourd'hui » en premier, jauge de progression, actions rapides. Liste de cartes sur mobile.

**Acceptation** — un seul appel API peint l'écran ; aucun `DataTable` rendu sous `md` (test Playwright à 360 px).

### T22 🟡 Retards, amendes, avances, litiges
Échelle de relance, application et annulation d'amendes, avances entre membres, contestation depuis chaque écriture.

**Acceptation** — tests unitaires du calcul d'amende `once` et `per_day` avec plafond ; aucune amende appliquée sans validation explicite ; l'annulation exige un motif.

### T23 🟡 Notifications
Push PWA, préférences par tontine, plages de silence, liens `wa.me` pré-remplis pour les retardataires.

**Acceptation** — **aucune notification ne contient de montant** (test) ; les rappels ne partent pas pendant les plages de silence ; l'écran WhatsApp indique clairement que l'envoi est manuel.

---

## Phase 6 — Finition

### T24 🔴 PWA et hors-ligne
Manifeste, service worker, file d'attente de mutations, bandeau de connexion, pages d'aide en cache.

**Acceptation** — déclarer un paiement sans réseau puis retrouver la déclaration synchronisée au retour ; installation testée sur Chrome Android et Safari iOS ; aucune perte de saisie.

### T25 🔴 Budgets de performance en CI
Lighthouse CI, budgets appliqués, build en échec au dépassement.

**Acceptation** — JS initial < 180 Ko, premier chargement < 250 Ko hors images, navigation < 40 Ko ; Performance ≥ 90 sur `/`, ≥ 85 sur `/app` ; Accessibilité ≥ 95.

### T26 🔴 E2E des quatre parcours critiques
Inscription OTP · rejoindre par lien · cotiser (déclarer → confirmer) · verser (déclarer → accuser réception).

**Acceptation** — les 4 scénarios passent à 360 px et 1280 px.

### T27 🟡 États d'écran systématiques
Passe finale : chaque page implémente chargement, vide, erreur, hors-ligne, contenu.

**Acceptation** — checklist par page dans le PR, aucune exception.

---

## Hors périmètre MVP

Réconciliation automatique Wave Business (N2), tontines ouvertes (marché B), canaux Orange/MTN/Moov, WhatsApp Business API, abonnement, back-office, score de confiance, tontine journalière, PI-SPI.

**Prévoir dès maintenant l'emplacement UI** de : « Connecter mon compte Wave Business » (grisé, « bientôt ») dans les réglages, et le rail PI-SPI dans le sélecteur de canal. Rien d'autre.
