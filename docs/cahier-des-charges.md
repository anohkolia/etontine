# CAHIER DES CHARGES FRONTEND — APPLICATION DE GESTION DE TONTINE (CÔTE D'IVOIRE)

**Version :** 2.1 (révision critique de la v1.0 + arbitrages produit intégrés)
**Stack :** Nuxt 4 fullstack (client + routes serveur Nitro) + PrimeVue 4 + Tailwind CSS 4 — PWA mobile-first
**Cible :** bureaux de tontine (président / trésorier / censeur) et membres, en Côte d'Ivoire
**Date de révision :** août 2026

---

## À QUOI SERT CE DOCUMENT

C'est le document de **cadrage produit** : le *pourquoi* et le *quoi*. Il explique les décisions, le contexte ivoirien et les contraintes réglementaires qui justifient la forme de l'application.

**Ce n'est pas le document d'implémentation.** Pour construire, se référer à :

| Fichier | Contenu |
|:--|:--|
| `CLAUDE.md` | Règles projet, versions imposées, interdits |
| `docs/data-model.md` | Entités, machines à états, matrice de permissions |
| `docs/api-contract.md` | Routes Nitro, format d'erreur, routes client |
| `docs/backlog.md` | Tickets ordonnés avec critères d'acceptation |
| `shared/schemas/` | Schémas Zod, source de vérité des énumérations et transitions |

En cas de contradiction entre ce document et les quatre précédents, **ce sont les documents d'implémentation qui font foi** — et la contradiction doit être signalée pour correction ici.

Décisions actées : traceur pur (Wave direct), tontine rotative, marchés A et B avec régimes séparés. Points encore ouverts : §14.

---

## 0. NOTE DE RÉVISION — CE QUI A CHANGÉ ET POURQUOI

Cette version corrige des erreurs factuelles, comble des trous fonctionnels majeurs et ajoute les contraintes réglementaires qui pilotent réellement l'interface. Les points marqués **[À ARBITRER]** attendent une décision produit de votre part.

| # | Point v1.0 | Problème | Correction v2.0 |
|:--|:--|:--|:--|
| 1 | « MTN Moov » comme un seul moyen de paiement | MTN MoMo et Moov Money sont **deux opérateurs distincts**, avec deux parcours, deux codes USSD et deux marques | 4 rails séparés : Wave, Orange Money, MTN MoMo, Moov Money (§2.3) |
| 2 | « Redirection Wave ou déclenchement du Push USSD (OM/MTN) » | Les 4 parcours sont techniquement **très différents** ; Orange Money CI exige que le client génère lui-même un OTP via `#144*82#` | Parcours détaillé et écrans dédiés par opérateur (§6.6) |
| 3 | Djamo cité en §1.1, absent du module paiement | Incohérence ; Djamo est une néobanque/carte, pas un wallet MM classique | Rail « carte/compte » optionnel, hors MVP (§2.3) |
| 4 | Aucun module de **versement du pot au bénéficiaire** | C'est pourtant le moment le plus critique et le plus risqué de la tontine | Nouveau **Module 7 — Décaissement** (§6.7) |
| 5 | Frais de transaction jamais mentionnés | En Afrique de l'Ouest, un frais non annoncé casse la confiance immédiatement | Affichage obligatoire « cotisation + frais = total » (§6.6) |
| 6 | Pas de gestion de la **défaillance** (membre qui disparaît après avoir mangé) | Risque n°1 de toute tontine rotative | Nouveau **Module 9** (§6.9) |
| 7 | Le registre n'est exportable que par le président | La transparence pour **tous** les membres est l'argument de vente principal | Registre lisible par tous, export selon rôle (§6.8) |
| 8 | KYC/KYB + signature de contrat dès l'onboarding | Tue la conversion dès l'écran 2 | KYC **progressif**, déclenché par palier (§6.1) |
| 9 | Rôle unique « Organisateur » | Une tontine réelle a un **bureau** : président, trésorier, secrétaire, censeur | RBAC revu (§4) |
| 10 | « Ramassage » | Terme peu employé sur le terrain | Lexique produit aligné sur l'usage ivoirien : « la main », « prendre la main » (§5) |
| 11 | Score de confiance public | Publier un score de mauvais payeur = risque juridique (loi n°2013-450 sur les données personnelles) + risque de diffamation | Score privé + preuves de bonne conduite uniquement (§6.11) |
| 12 | « Lighthouse ≥ 90 sur l'audit PWA » | **La catégorie PWA a été retirée de Lighthouse en v12 (mai 2024)** — ce critère n'existe plus | Critères remplacés par budgets Core Web Vitals + checklist d'installabilité (§11) |
| 13 | « PrimeVue 3+ / 4+ », « Yup ou Zod », « Tailwind 3+ » | Un cahier des charges ne doit pas laisser le choix de version au prestataire | Versions figées + configuration de couches CSS (§3) |
| 14 | `DataTable` sur mobile | Composant lourd et inutilisable sous 400 px | Liste de cartes sur mobile, `DataTable` à partir de `md` (§3.5) |
| 15 | Aucune mention du cadre BCEAO | Encaisser des fonds sans agrément est un risque existentiel pour le projet | §2.1 + conséquences directes sur les libellés d'interface |
| 16 | Rien sur les membres **sans smartphone** | Une part importante des membres n'installera jamais l'app | Mode « membre géré » + confirmation SMS (§6.2) |
| 17 | Un seul modèle de tontine | La v1 ne couvre que la tontine rotative ; la tontine de marché (journalière, avec collecteur) est très répandue à Abidjan | Typologie et modèles paramétrables (§1.1, §6.3) |
| 18 | Responsive « 375 px à 430 px » | Beaucoup d'entrées de gamme et l'iPhone SE tombent à 320–360 px | Plancher à **320 px** (§10) |

---

## 0.1 DÉCISIONS ACTÉES (v2.1)

| Décision | Choix retenu |
|:--|:--|
| **Flux d'argent** | **Traceur pur.** Le participant envoie directement sur le numéro / lien Wave de l'organisateur, renseigné à son inscription. L'application ne détient, n'encaisse et ne reverse jamais de fonds. |
| **Marché** | Les deux : numériser des tontines existantes **et** permettre la création de tontines entre personnes qui ne se connaissent pas (avec un régime renforcé, §1.2). |
| **Modèle** | **Tontine rotative classique** en cible unique du MVP. Les autres modèles restent dans le modèle de données mais pas dans l'interface. |

### ⚠️ Conséquence n°1 : l'application n'a aucune preuve automatique du paiement

C'est **la** conséquence structurante du choix « Wave direct », et elle doit être comprise avant toute maquette.

Quand l'argent va du wallet du membre vers le wallet personnel de l'organisateur, la transaction se déroule **entièrement hors de votre système**. Aucun webhook, aucun callback, aucune API ne vous informe. L'application ne peut donc pas afficher « Payé ✅ » : elle ne le sait pas.

Il en découle un modèle de statut à **cinq états** au lieu de deux, et un **registre à double entrée** (le membre déclare, le bureau confirme). C'est décrit au Module 6, qui a été entièrement réécrit pour cette architecture.

Deux niveaux de maturité sont prévus :

| Niveau | Mécanisme | Statut |
|:--|:--|:--|
| **N1 — Déclaratif** | Le membre déclare son paiement (référence de transaction + capture facultative), le trésorier confirme. Double confirmation obligatoire. | **MVP** |
| **N2 — Réconciliation automatique** | L'organisateur connecte son **compte Wave Business** à l'application (clé API / autorisation). L'app lit alors ses transactions entrantes et rapproche automatiquement, **sans jamais détenir les fonds**. | V1.5 — à valider avec Wave |

Le niveau 2 est le vrai produit. Le niveau 1 est ce qui permet de lancer sans dépendre d'un partenariat. Concevoir les écrans dès maintenant pour que le passage de N1 à N2 ne change **que la source du statut**, pas la mise en page.

### ⚠️ Conséquence n°2 : le pot dort dans le portefeuille personnel du président

C'est précisément le problème de confiance que la tontine papier connaît déjà. Votre application ne le supprime pas — elle le **rend visible**. Assumez-le dans le discours produit plutôt que de le masquer : *« Nous ne gardons pas ton argent. Nous gardons la preuve. »*

Deux effets pratiques à traiter dans l'interface :

- **Plafonds de portefeuille.** Un compte de monnaie électronique est soumis à des plafonds de solde et de transaction (encadrement BCEAO, niveau de KYC du titulaire). Un pot de 12 membres × 50 000 FCFA = 600 000 FCFA peut buter dessus. Le simulateur de l'étape 2 du wizard doit **alerter l'organisateur** : « Ton pot atteindra environ 600 000 FCFA. Vérifie le plafond de ton compte Wave avant de démarrer. » Ne pas coder de seuil en dur : le rendre configurable côté back-office.
- **Mention légale permanente.** Sur l'écran de paiement et dans les CGU : l'application est un outil de suivi, elle n'est pas partie au transfert et ne garantit pas la restitution des fonds. Formulation à faire relire par un juriste.

---

## 1. CONTEXTE PRODUIT (RÉVISÉ)

### 1.1 La tontine ivoirienne : typologie réelle

La v1.0 modélise implicitement un seul cas. Il en existe au moins quatre sur le terrain, et l'interface doit savoir lequel elle affiche :

| Modèle | Fonctionnement | Fréquence typique | Implication frontend |
|:--|:--|:--|:--|
| **Tontine rotative (ROSCA)** | Chacun cotise, un membre prend la totalité du pot à chaque tour | Hebdo / mensuelle | Modèle par défaut du MVP |
| **Tontine de marché (journalière)** | Un collecteur passe chaque jour, prend un versement ; il se rémunère en gardant l'équivalent d'un versement par cycle | Journalière, 250–2 000 FCFA | Écran de collecte rapide multi-membres, mode hors-ligne indispensable |
| **Caisse de solidarité / d'épargne** | On cotise sans rotation ; le fonds sert aux événements (décès, mariage, maladie) ou est partagé en fin d'année | Mensuelle | Pas de « main », mais des demandes d'aide et des votes |
| **Tontine à enchères** | Le tour se vend au plus offrant (escompte) | Variable | Hors MVP, structure de données à prévoir |

**Décision demandée [À ARBITRER n°1] :** lequel de ces modèles est prioritaire au lancement ? La v2 est écrite pour la **rotative** en cible principale, avec la **journalière** en second.

### 1.2 Deux marchés très différents

- **A — Numériser une tontine existante** : le groupe existe, la confiance existe, on remplace le carnet. Adoption facile, valeur perçue moyenne, risque faible.
- **B — Créer une tontine entre personnes qui ne se connaissent pas** : valeur perçue forte, mais risque de défaut et d'arnaque massif ; exige garanties, KYC lourd et probablement un agrément.

**DÉCISION : les deux marchés.** C'est jouable, mais **pas sous le même régime**, et il faut être lucide sur le risque : en marché B, vous demandez à une personne d'envoyer de l'argent sur le **numéro Wave personnel d'un inconnu**, via votre interface. Juridiquement vous n'êtes pas responsable ; en pratique, la victime d'une arnaque accusera l'application, et un seul dossier médiatisé suffit à tuer le produit.

Les deux marchés doivent donc être **visuellement et fonctionnellement distincts** :

| | Tontine privée (marché A) | Tontine ouverte (marché B) |
|:--|:--|:--|
| Accès | Sur invitation uniquement (lien / QR) | Découvrable, candidature |
| KYC organisateur | Palier 1 | **Palier 2 obligatoire** (CNI + selfie vérifiés) avant publication |
| Plafond de cotisation | Libre | **Plafonné** au lancement (ex. 25 000 FCFA/part), relevé après historique |
| Historique exigé | Aucun | L'organisateur doit avoir terminé ≥ 1 tour complet en tontine privée |
| Avertissement | Discret | **Bandeau permanent** : « Tu ne connais pas ce groupe. L'application ne détient pas les fonds et ne les garantit pas. » |
| Badge visuel | Neutre | Pastille « Organisateur vérifié » ou « Non vérifié », jamais ambigu |

**Recommandation de séquencement :** livrer A au MVP, ouvrir B une fois que vous disposez d'organisateurs ayant un historique réel dans votre système. Ouvrir B dès le jour 1 revient à lancer une place de marché de confiance sans aucune donnée de confiance.

### 1.3 Concurrence à connaître

Des acteurs sont déjà positionnés en Afrique francophone : **Maman Tontine** (Sénégal, Côte d'Ivoire, Mali, Guinée), **Djangui** (Cameroun, Sénégal, Côte d'Ivoire), **E-Tontine** (Sénégal), et des éditeurs de logiciels de microfinance qui intègrent un module tontine (**SmartMifin**, Webgram). Le différenciateur ne sera donc **pas** « une app de tontine », mais la qualité du parcours de paiement local et la crédibilité de la traçabilité.

### 1.4 Objectifs frontend, rendus mesurables

| Objectif | Indicateur cible |
|:--|:--|
| Cotiser vite | ≤ 3 interactions entre l'ouverture de l'app et la confirmation de paiement |
| Fonctionner en 3G | Premier rendu utile < 3 s sur profil « Slow 4G » throttlé, < 5 s en 3G réelle |
| Frugalité data | < 250 Ko transférés au premier chargement (hors images), < 40 Ko par navigation ultérieure |
| Créer une tontine | ≤ 90 s pour un organisateur qui découvre l'app |
| Compréhension | Un membre non lettré doit identifier son statut de paiement **par la couleur et l'icône seules** |

---

## 2. CONTRAINTES STRUCTURANTES (NOUVEAU — PILOTE TOUT LE RESTE)

### 2.1 Cadre réglementaire BCEAO

L'**Instruction n°001-01-2024 du 23 janvier 2024** encadre la fourniture de services de paiement dans l'UMOA : seuls les banques, établissements financiers, SFD, EME et établissements de paiement **agréés ou enregistrés par la BCEAO** peuvent fournir des services de paiement. Le capital exigé se situe entre 10 et 100 millions FCFA selon la catégorie, et très peu d'agréments ont été délivrés à ce jour.

**Architecture retenue : traceur pur.** L'argent ne transite jamais par vous. Le membre envoie sur le numéro ou le lien Wave de l'organisateur ; l'application enregistre, rapproche et prouve.

C'est le choix le plus sûr sur le plan réglementaire : vous ne fournissez pas de service de paiement au sens de l'instruction, vous éditez un logiciel de gestion. **Trois garde-fous à ne pas franchir**, sous peine de basculer dans le champ de l'agrément :

1. **Ne jamais toucher les fonds**, même transitoirement, même « le temps du reversement ».
2. **Ne pas prélever de commission sur le montant transféré.** Un abonnement ou un frais de service facturé séparément est une prestation logicielle ; un pourcentage prélevé sur la cotisation ressemble beaucoup à une commission de service de paiement.
3. **Ne pas initier l'ordre de paiement.** L'utilisateur déclenche lui-même le transfert dans Wave. Votre application affiche, guide et enregistre — elle n'ordonne pas.

Conséquences frontend, à appliquer partout :

- Aucun « solde », aucun « portefeuille », aucun « compte » dans le vocabulaire d'interface.
- Verbes autorisés : **déclarer, confirmer, enregistrer, justifier, rapprocher**. Verbes interdits : encaisser, créditer, transférer, reverser, débiter.
- Un écran de **preuve de paiement** (référence de transaction Wave, capture facultative) devient un élément central du parcours, pas une option.

> **Règle d'interface non négociable, quelle que soit l'option :** ne jamais écrire « votre argent est chez nous », « solde de la tontine », « nous conservons ». Un audit réglementaire lit d'abord vos écrans.

**À anticiper : PI-SPI.** La BCEAO a lancé le 30 septembre 2025 la Plateforme Interopérable du Système de Paiement Instantané de l'UEMOA, qui rend les transferts entre particuliers instantanés, interopérables entre réseaux et gratuits pour les particuliers, 24 h/24. Le délai de connexion des établissements a été prolongé à septembre 2026 (juin 2027 pour la microfinance). **Conséquence produit majeure :** l'argument « je centralise vos paiements » perdra de sa valeur quand transférer d'un wallet à un autre sera gratuit et instantané. Votre valeur doit être la **gestion et la preuve**, pas le transport de l'argent. Prévoir dès maintenant un rail « PI-SPI » dans le sélecteur de moyens de paiement.

### 2.2 Données personnelles

Le traitement de données personnelles en Côte d'Ivoire relève de la **loi n°2013-450** et de l'**ARTCI** (déclaration/autorisation préalable). L'app manipule des données financières nominatives et un historique de comportement de paiement, ce qui est sensible.

Conséquences directes sur l'interface :
- Écran de **consentement explicite** à l'inscription, granulaire (traitement, notifications WhatsApp, partage du score).
- Un membre doit pouvoir **exporter et supprimer** ses données (`/profile/donnees`).
- **Le score de confiance ne doit pas être public par défaut** (voir §6.11) : afficher publiquement qu'une personne est mauvaise payeuse expose à la fois au contentieux données personnelles et à la diffamation.
- Politique de confidentialité et CGU accessibles **avant** l'inscription, pas seulement en pied de page.

### 2.3 Les rails de paiement, dans la réalité

| Rail | Part de marché indicative (2026) | Parcours réel | Contrainte UX |
|:--|:--|:--|:--|
| **Wave CI** | ~40 % des transactions | Application-first, pas d'USSD. Redirection vers une page de paiement Wave ou scan QR. Frais côté marchand ~1 % | Le plus fluide. Deep link + retour applicatif à gérer (l'utilisateur revient-il ?) |
| **Orange Money CI** | Leader historique, réseau d'agents le plus dense | Web Payment : le client **génère lui-même un OTP** via `#144*82#`, puis le saisit sur la page marchand | **Ce n'est pas un push.** Écran explicatif avec le code composable en un tap (`tel:` link), champ OTP, compte à rebours |
| **MTN MoMo CI** | ~2ᵉ position | Notification de validation sur le téléphone, confirmation par code secret | Écran d'attente avec polling + « je n'ai rien reçu » |
| **Moov Money CI** | Segment prix-sensible, zones moins couvertes | Menu `*155#` | Idem OM, parcours USSD assisté |
| **Cash / espèces** | Toujours majoritaire dans beaucoup de groupes | Le trésorier encaisse physiquement | **Double confirmation** obligatoire (§6.6) |
| **PI-SPI** | En déploiement | Virement instantané interopérable | À prévoir, non implémenté au MVP |

**Point critique souvent raté :** le préfixe du numéro (07 Orange, 05 MTN, 01 Moov) indique l'opérateur télécom, **pas le wallet utilisé**. Wave fonctionne sur n'importe quel numéro. Ne **jamais** présélectionner automatiquement le moyen de paiement à partir du préfixe : proposer, ne pas décider.

**Prélèvement automatique :** les paiements récurrents ne sont pas nativement supportés par tous les opérateurs. **Ne promettez pas « cotisation automatique » dans l'interface** tant que ce n'est pas contractuellement acquis. Le libellé correct est « rappel automatique », pas « prélèvement automatique ».

### 2.4 Conséquence du choix « collecte sur Wave »

Wave pèse environ 40 % des transactions de mobile money du pays. Autrement dit, **la majorité des membres potentiels n'ont pas Wave comme portefeuille principal**. Trois réponses à intégrer dès le MVP :

1. **L'organisateur peut renseigner plusieurs numéros de collecte**, pas seulement Wave : un numéro Wave, un numéro Orange Money, un numéro Moov ou MTN. L'écran de paiement propose alors au membre le canal correspondant à son propre portefeuille. Techniquement c'est le même parcours déclaratif, seul le numéro affiché change — le coût de développement est marginal, le gain de couverture est majeur.
2. **Le cas « je n'ai pas le même réseau »** doit être traité explicitement dans l'interface, avec une explication du transfert inter-réseaux et de son coût. Ne pas laisser le membre bloqué devant un numéro qu'il ne sait pas comment atteindre.
3. **PI-SPI est votre horizon.** Quand les transferts entre portefeuilles de réseaux différents seront instantanés et gratuits pour les particuliers, la contrainte « quel opérateur a l'organisateur » disparaît. Prévoir l'emplacement dans le sélecteur dès maintenant.

**Frais à afficher :** chez Wave, l'expéditeur supporte des frais d'envoi (de l'ordre de 1 %) tandis que le retrait est gratuit ; les autres opérateurs facturent plutôt le retrait. Le membre doit voir **avant de partir payer** ce que la cotisation lui coûtera réellement. Ne pas coder les taux en dur : les rendre administrables depuis le back-office, ils changent.

---

## 3. STACK TECHNIQUE & DESIGN SYSTEM (CORRIGÉ)

### 3.1 Versions figées

| Brique | Version imposée | Note |
|:--|:--|:--|
| Nuxt | 4.x | `compatibilityVersion: 4` |
| Vue | 3.5+ | |
| PrimeVue | **4.x** | Le mode « unstyled + Volt » est recommandé pour la maîtrise du poids |
| Tailwind CSS | **4.x** | Configuration en CSS (`@import "tailwindcss"`), plus de `tailwind.config.js` |
| `tailwindcss-primeui` | version **CSS** (compatible TW4) | `@import "tailwindcss-primeui";` |
| Validation | **Zod** uniquement | Schémas partagés avec le backend ; supprimer Yup du périmètre |
| Formulaires | Vee-Validate + `@vee-validate/zod` | |
| État | Pinia + `pinia-plugin-persistedstate` | |
| Icônes | `@nuxt/icon` en mode **local** (bundle statique) | Interdiction d'appeler une API d'icônes à l'exécution : coût data et point de panne |
| PWA | `@vite-pwa/nuxt` | |
| i18n | `@nuxtjs/i18n` dès le départ, même si une seule langue au lancement | |

> **Attention TW4 + PrimeVue :** l'intégration a changé avec Tailwind 4 (plus de PostCSS, plugin Vite, config en CSS). L'ordre des couches CSS doit être explicitement défini pour que PrimeVue s'insère entre `base` et `components`, sinon des conflits de style apparaîtront. Ce point est un **critère de recette** (§12).

### 3.2 Rendu

- Landing `/` : **pré-rendu statique** (SEO + premier chargement instantané).
- Application authentifiée : **SPA/CSR** derrière le shell PWA. Le SSR sur des pages personnalisées et hors-ligne apporte de la complexité sans gain ici.
- Configuration via `routeRules` de Nuxt.

### 3.3 Palette corrigée

```css
/* app/assets/css/main.css — Tailwind 4 */
@import "tailwindcss";
@import "tailwindcss-primeui";

@theme {
  /* Marque */
  --color-brand-primary: #00785A;  /* assombri : contraste AA sur blanc pour le texte */
  --color-brand-dark:    #0A2540;
  --color-brand-accent:  #C24E00;  /* l'orange #FF6B00 échoue le contraste texte AA */

  /* Statuts — jamais la couleur seule, toujours couleur + icône + mot */
  --color-status-paid:    #00785A;
  --color-status-pending: #B45309;
  --color-status-late:    #B91C1C;

  /* Surfaces */
  --color-surface-bg:     #F8FAFC;
  --color-surface-card:   #FFFFFF;
  --color-surface-border: #E2E8F0;
}
```

**Couleurs des opérateurs :** `#1DC3F2` (Wave), `#FF6600` (Orange Money), `#FFCC00` (MTN), `#005CA9` (Moov) sont conservées **uniquement comme pastilles/logos dans le sélecteur de paiement**, jamais comme couleurs d'interface. Deux raisons : usage de marque tierce, et risque de laisser croire que l'application est éditée par l'opérateur. Prévoir un **fond neutre** derrière chaque logo (le jaune MTN est illisible sur blanc).

### 3.4 Typographie et formats

- Police **système** (`system-ui`) au MVP : zéro téléchargement de police, zéro FOUT en 3G. Une police personnalisée est un luxe qui coûte 30–80 Ko.
- Taille de base **16 px minimum**, montants en 24–32 px semi-gras.
- **Format monétaire imposé :** `25 000 FCFA` — espace insécable fine comme séparateur de milliers, **aucune décimale**, suffixe « FCFA » (pas « XOF », pas « F CFA » de façon inconstante). Utiliser un composable `useMoney()` unique dans toute l'app.
- Dates : `jeu. 15 août` en affichage, jamais `2026-08-15`. Fuseau **GMT/UTC+0** (pas d'heure d'été en CI).
- Cibles tactiles ≥ 44 × 44 px.

### 3.5 Règles de composants PrimeVue

| Situation | Interdit | Imposé |
|:--|:--|:--|
| Liste de membres / registre sur mobile | `DataTable` | Liste de `Card` empilées, virtualisée au-delà de 50 lignes ; `DataTable` uniquement ≥ `md` |
| Sélection du moyen de paiement | `Dropdown` | Grille de boutons-logos tapables (`SelectButton` custom) |
| Saisie de montant | `InputNumber` avec spinner | Clavier numérique natif (`inputmode="numeric"`), montants suggérés en chips (5 000 / 10 000 / 25 000) |
| Étapes du wizard | `Steps` cliquable librement | `Stepper` linéaire avec sauvegarde de brouillon à chaque étape |
| Confirmation critique (versement, suppression) | `Dialog` simple | `Dialog` + ressaisie d'un élément (montant ou 4 derniers chiffres du numéro) |
| Import global de PrimeVue | `components: { include: '*' }` | Import explicite composant par composant (poids du bundle) |

---

## 4. RÔLES & PERMISSIONS (RBAC RÉVISÉ)

Une tontine ivoirienne fonctionne rarement avec une seule personne aux commandes. Le modèle doit refléter le **bureau**.

| Rôle | Droits | Note |
|:--|:--|:--|
| **Visiteur** | Landing, tarifs, aide, inscription | |
| **Membre** | Voir ses tontines, cotiser, consulter **l'intégralité du registre** de ses tontines, voir son rang et sa date de main, contester une écriture | La lecture complète du registre par tous les membres est le cœur de la promesse |
| **Membre géré** *(nouveau)* | N'a pas l'app ; enregistré par le bureau ; reçoit SMS/WhatsApp ; peut confirmer par lien | Indispensable en pratique |
| **Trésorier** | + enregistre les paiements cash, initie les versements | |
| **Président** | + crée/configure la tontine, invite, applique les pénalités, ouvre/clôture un cycle, et à les même droits et rôle Trésorier, Censeur | |
| **Censeur / commissaire** *(nouveau)* | Lecture totale + **contre-validation** des versements et des modifications de l'ordre de rotation | Rôle de contrôle bien réel dans les tontines structurées ; c'est aussi votre meilleure défense anti-fraude |
| **Super-admin** | Back-office, abonnements, support, vérification des organisateurs | Interface **séparée**, pas un rôle dans l'app membre |

**Règles transverses :**
- Toute action sensible (modifier l'ordre de rotation, changer le montant, exclure un membre, déclencher un versement) exige **deux validations distinctes** quand la tontine dépasse un seuil configurable, et est **journalisée et visible de tous**.
- Un utilisateur peut être membre dans une tontine et président dans une autre : la notion de rôle est **par tontine**, jamais globale. La v1.0 laissait entendre un « rôle par défaut » global à l'inscription — à supprimer.

---

## 5. LEXIQUE PRODUIT (NOUVEAU — À RESPECTER DANS TOUTE L'UI)

L'application doit parler comme les gens, pas comme un logiciel bancaire.

| Concept technique | À afficher | À éviter |
|:--|:--|:--|
| Bénéficiaire du tour | **« Celui qui prend la main »**, « c'est le tour de Awa » | « Ramassage », « bénéficiaire du décaissement » |
| Recevoir le pot | **« Prendre la main »**, « manger la tontine » | « Percevoir les fonds » |
| Cotisation | **« Cotisation »**, « ta part » | « Échéance », « prélèvement » |
| Cycle complet | **« Tour complet »** | « Itération », « cycle N » |
| Groupe | **« La tontine »**, « le groupe » | « L'instance », « le pool » |
| Personne qui gère | **« Le président », « la mère de la tontine »**, « le trésorier » | « L'administrateur », « l'organisateur » |
| Part supplémentaire | **« Double part »** *(fonction manquante en v1 — voir §6.3)* | |
| Retard | **« En retard »**, « pas encore payé » | « Défaut de paiement », « impayé constaté » |
| Pénalité | **« Amende »** (terme réellement employé) | « Frais de recouvrement » |

Registre de langue : français ivoirien simple et respectueux. Le tutoiement est acceptable entre membres mais **le vouvoiement est plus sûr** pour les messages officiels du système (rappels, reçus). Ne pas forcer le nouchi dans l'interface : il vieillit mal et exclut une partie des utilisateurs. Le laisser aux messages libres rédigés par les membres.

---

## 6. MODULES FRONTEND (RÉVISÉS)

### Module 1 — Authentification & onboarding

**Corrections :** le KYC et la signature de contrat sont retirés de l'inscription.

1. Saisie du numéro : format ivoirien **10 chiffres**, préfixes mobiles `01` (Moov), `05` (MTN), `07` (Orange). Normalisation E.164 `+225XXXXXXXXXX` côté client. Masque de saisie `XX XX XX XX XX`. Bouton d'import depuis les contacts si l'API le permet.
2. OTP 6 chiffres — `InputOtp`, remplissage automatique via `autocomplete="one-time-code"`, renvoi possible après 30 s, **fallback appel vocal** après 2 échecs (le SMS passe mal dans certaines zones).
3. Profil minimal : prénom, nom, photo optionnelle. **Aucun choix de rôle** à ce stade.
4. Consentement données personnelles (§2.2), explicite et séparé du consentement marketing.

**KYC progressif** — remplace le KYC bloquant de la v1 :

| Palier | Déclencheur | Demandé |
|:--|:--|:--|
| 0 | Inscription | Numéro vérifié |
| 1 | Rejoindre une tontine | Nom complet |
| 2 | Créer une tontine, ou pot > seuil réglementaire | Pièce d'identité (CNI), selfie |
| 3 | Volume élevé / organisateur professionnel | Justificatif d'activité, contrat d'engagement signé électroniquement |

Le contrat d'engagement du palier 3 doit être présenté avec un **résumé lisible en 5 points avant le texte intégral**, et sa valeur juridique repose sur un dispositif de signature électronique conforme — à valider juridiquement, ce n'est pas une simple case à cocher.

**Sécurité :** verrouillage de l'app par code PIN à 4 chiffres (+ biométrie si disponible), liaison au device, et **procédure explicite de changement de numéro / SIM swap** (l'échange de SIM est un vecteur de fraude courant : re-vérification par le bureau de la tontine, délai de 48 h avant tout versement sur un nouveau numéro).

### Module 2 — Rejoindre une tontine *(nouveau)*

Le module d'invitation était mentionné en une ligne côté organisateur ; c'est en réalité le parcours d'acquisition principal.

- Route `/join/[token]` fonctionnelle **sans être connecté** : le visiteur voit d'abord *ce qu'on lui propose* (nom de la tontine, président, montant, fréquence, nombre de membres, date de démarrage), puis s'inscrit.
- Lien court partageable, message WhatsApp pré-rempli, QR code affichable en réunion.
- Écran de **récapitulatif d'engagement** avant validation : « Tu t'engages à verser 10 000 FCFA chaque mois pendant 10 mois, soit 100 000 FCFA au total. Tu recevras 100 000 FCFA à ton tour. » — cette phrase unique évite la majorité des malentendus.
- Statut « en attente d'acceptation par le président ».
- **Mode membre géré :** le bureau ajoute un membre par nom + numéro ; celui-ci reçoit un SMS avec un lien de confirmation à usage unique. Tant qu'il n'a pas confirmé, il apparaît avec une pastille « non confirmé ».

### Module 3 — Création et configuration (wizard révisé)

**Étape 0 — Type d'accès** *(remplace le choix de modèle : seule la rotative est au MVP)* : tontine **privée** (sur invitation) ou **ouverte** (visible publiquement). Le second choix déclenche le régime renforcé du §1.2 : vérification d'identité obligatoire, plafond de cotisation, avertissements. Si l'organisateur n'a pas le palier KYC requis, l'option est visible mais grisée avec l'explication — ne jamais la masquer, l'utilisateur doit savoir qu'elle existe et ce qu'il faut pour y accéder.

**Étape 1 — Informations** : nom, description, avatar, lieu ou quartier (utile : « tontine du marché de Cocody »).

**Étape 2 — Argent** :
- Montant de la part, fréquence (journalière / hebdomadaire / bimensuelle / mensuelle).
- **Nombre de parts par membre** *(manquant en v1)* : dans la pratique, un membre prend souvent deux parts et passe deux fois. C'est une règle de calcul structurante, pas une option cosmétique.
- **Canaux de collecte** *(central dans cette architecture)* : l'organisateur renseigne le ou les numéros sur lesquels il recevra les cotisations — Wave en principal, éventuellement Orange Money / MTN / Moov (§2.4). Vérification du numéro par OTP **obligatoire** : c'est le numéro vers lequel l'application enverra des dizaines de membres, il ne peut pas être saisi à l'aveugle. Toute modification ultérieure déclenche une re-vérification, une notification à **tous** les membres et un gel de 48 h — c'est le vecteur d'arnaque le plus évident du produit.
- **Qui paie les frais de transaction** : la tontine ou le membre ? Choix explicite, affiché ensuite partout.
- **Simulateur en direct** : « 12 membres × 10 000 FCFA = 120 000 FCFA par tour, sur 12 mois ». Un organisateur doit voir la conséquence de ses réglages avant de valider.
- **Alerte de plafond** : si le pot dépasse le seuil configuré, message d'avertissement invitant l'organisateur à vérifier les plafonds de son compte de monnaie électronique avant de démarrer (§0.1).

**Étape 3 — Ordre de passage** : tirage au sort (avec animation de tirage et **preuve horodatée du résultat**, pour couper court aux soupçons), ordre fixe défini par le président, ou ordre négocié. Enchères : hors MVP.

**Étape 4 — Règles** : amendes de retard (montant fixe ou par jour, avec plafond), délai de grâce, règle en cas d'absence, **règle de sortie anticipée** *(manquant en v1)*.

**Étape 5 — Récapitulatif et publication** : aperçu de ce que verront les membres, puis génération du lien d'invitation.

Brouillon sauvegardé à chaque étape ; on doit pouvoir fermer l'app et reprendre.

### Module 4 — Tableau de bord du bureau

- En-tête : cycle en cours, montant collecté / attendu, **jauge de progression** (barre Tailwind plutôt que `Knob` : plus légère et plus lisible en petit).
- **Bloc « à traiter aujourd'hui »** en premier : X membres en retard, Y paiements cash à confirmer, versement à effectuer le Z. C'est ce qui remplace vraiment le carnet.
- Actions rapides : relancer les retardataires, enregistrer un paiement cash, inviter, effectuer le versement.
- Vue « prochaine main » : qui, quand, combien.
- Sur mobile : liste de cartes. `DataTable` réservé au desktop.

### Module 5 — Espace membre

- **Une seule information dominante à l'ouverture** : ai-je payé ce tour, oui ou non ? Statut plein écran, couleur + icône + texte.
- Bouton « Cotiser maintenant » persistant.
- « Ta main : 15 septembre — tu es 3ᵉ sur 10 » avec une frise de rotation (`Timeline`) montrant qui est déjà passé.
- Total déjà versé / total à recevoir.
- Accès au registre complet et au bouton « signaler une erreur ».

### Module 6 — Paiement déclaratif à double confirmation *(entièrement réécrit pour l'architecture Wave direct)*

Puisque l'application ne reçoit aucune notification de transaction (§0.1), le paiement n'est pas un événement système : c'est une **déclaration du membre, confirmée par le bureau**. Tout le module découle de là.

#### 6.1 Le modèle de statut — cinq états, pas deux

| Statut | Couleur + icône | Qui le déclenche | Signification |
|:--|:--|:--|:--|
| **À payer** | Gris, sablier | Système | Cotisation attendue |
| **Déclaré** | **Bleu, avion en papier** | Le membre | « J'ai envoyé » — **surtout pas vert** |
| **Confirmé** | Vert, coche | Le trésorier | Le bureau a vu l'argent arriver |
| **Contesté** | Orange, point d'exclamation | L'un ou l'autre | Désaccord ouvert, dossier créé |
| **En retard** | Rouge, horloge | Système | Délai dépassé sans déclaration |

Le passage du bleu au vert est le cœur du produit. Une déclaration non confirmée sous **48 h** remonte automatiquement au bureau et devient visible de tous les membres dans le registre : c'est ce qui empêche un trésorier de laisser traîner, et c'est aussi ce qui protège le trésorier honnête.

#### 6.2 Parcours du membre

**Écran 1 — Récapitulatif avant de partir payer** (obligatoire, aucun montant surprise) :

```
Cotisation ................. 10 000 FCFA
Frais d'envoi Wave (~1 %) ......  100 FCFA
─────────────────────────────────────────
Tu vas envoyer ............. 10 100 FCFA
Reçu par la tontine ........ 10 000 FCFA
```

**Écran 2 — Où envoyer** : le canal de collecte de l'organisateur, mis en avant.
- Le **numéro Wave** en très gros, avec bouton **« Copier »** (essentiel : on copie-colle dans Wave).
- Bouton **« Ouvrir Wave »** (lien de paiement si l'organisateur en a fourni un, sinon deep link vers l'app).
- Le **nom du titulaire du compte** affiché en clair — le membre doit pouvoir vérifier dans Wave qu'il envoie bien à la bonne personne. C'est la protection anti-arnaque la plus efficace du parcours.
- Une **référence courte** à mettre en commentaire du transfert (ex. `TON-4F2A`), qui rendra le rapprochement possible manuellement aujourd'hui et automatiquement demain.
- Si plusieurs canaux existent (§2.4), sélecteur de logos.

**Écran 3 — Retour dans l'application** : « As-tu envoyé ? »
- `[Oui, j'ai envoyé]` → écran de déclaration
- `[Pas encore]` → retour, rappel programmable

**Écran 4 — Déclaration** :
- Montant (pré-rempli, modifiable — les paiements partiels existent et doivent être gérés)
- Date et heure (pré-remplies)
- **Référence de transaction Wave** (champ texte, facultatif mais fortement incité)
- **Capture d'écran** (facultative, compressée côté client à < 100 Ko avant envoi — ne jamais téléverser une photo brute de 4 Mo en 3G)
- Validation → statut **Déclaré**, notification immédiate au trésorier

**Garde-fou anti-double-déclaration** : bouton désactivé 90 s, clé d'idempotence, et détection d'une déclaration en doublon sur le même tour avec message explicite.

#### 6.3 Parcours du trésorier — la file de confirmation

L'écran le plus utilisé de l'application côté bureau. Une file simple, une action par carte :

```
┌────────────────────────────────────┐
│ Awa Koné            10 000 FCFA    │
│ Déclaré il y a 12 min · Wave       │
│ Réf. TON-4F2A · [voir la capture]  │
│  [ Confirmer ]   [ Je n'ai rien vu ]│
└────────────────────────────────────┘
```

- **Confirmer** → statut vert, écriture au registre, reçu généré, notification au membre.
- **Je n'ai rien vu** → statut *Contesté*, motif obligatoire, fil de discussion ouvert, notification au membre. **Jamais de rejet silencieux.**
- Bouton **« Tout confirmer »** pour le cas fréquent où le trésorier vérifie son historique Wave et valide 8 déclarations d'un coup.
- Le trésorier peut aussi **enregistrer un paiement lui-même** (membre géré, espèces) : le membre reçoit alors la demande de confirmation en sens inverse.

#### 6.4 Espèces et membres sans application

Le trésorier enregistre → le membre reçoit « Le trésorier a noté que tu as payé 10 000 FCFA le 12/08. C'est exact ? [Oui] [Non] », par notification ou par SMS avec lien signé. Sans réponse sous 72 h, l'écriture reste marquée « non confirmée par le membre » au registre, visible de tous.

#### 6.5 Reçus

Après confirmation : reçu partageable en **image légère (< 40 Ko)** prête pour WhatsApp — pas un PDF de 400 Ko. Contenu : montant, date, tontine, membre, référence, et un lien de vérification `/recu/[id]` consultable par n'importe qui.

Célébration sobre : coche animée en CSS. **Pas de confettis** — une bibliothèque canvas coûte plus cher en données qu'elle ne rapporte en émotion sur un réseau 3G.

#### 6.6 Préparer la réconciliation automatique (N2)

Pour que le passage au niveau 2 ne soit qu'un changement de source de données :

- Chaque déclaration porte déjà une **référence normalisée** et un **montant attendu**.
- Le champ « qui a confirmé » accepte dès maintenant la valeur `système` en plus de `trésorier`.
- Prévoir dans les réglages de la tontine un emplacement **« Connecter mon compte Wave Business »** (désactivé, libellé « bientôt disponible »), pour que la fonctionnalité soit anticipée dans la navigation.
- Le jour où la connexion existe, l'interface ne change pas : les cartes de la file de confirmation passent simplement de bleu à vert toutes seules.

### Module 7 — Décaissement / versement du pot *(NOUVEAU — CRITIQUE)*

Absent de la v1.0, alors que c'est le moment où la confiance se gagne ou se perd. Dans l'architecture retenue, **c'est l'organisateur qui envoie depuis son propre compte Wave** ; l'application prépare, guide et prouve.

1. **Écran de préparation** : pot constitué X / Y attendu, liste des manquants, alerte si le pot est incomplet. Le trésorier ne doit pas découvrir un trou au moment d'envoyer.
2. **Confirmation du bénéficiaire** : nom, numéro qui recevra, **4 derniers chiffres à ressaisir par le trésorier**. Alerte si le numéro a été modifié récemment (SIM swap, §6.1 Module 1). Bouton « Copier le numéro ».
3. **Contre-validation** par le président ou le censeur au-delà d'un seuil configurable.
4. **Exécution hors application** : le trésorier bascule dans Wave et envoie. Au retour, il **déclare le versement** (référence, capture facultative) — exactement le même mécanisme déclaratif que pour les cotisations, en sens inverse. Alternative : « versé en espèces », avec preuve.
5. **Accusé de réception** : le bénéficiaire confirme dans l'application (« J'ai bien reçu 120 000 FCFA »). Cette confirmation est **publiée au registre** et visible de tous. Sans elle, le tour n'est pas clôturé et le tableau de bord affiche l'alerte en permanence.
6. **Clôture du tour**, génération du procès-verbal, bascule vers le tour suivant.

> Ce va-et-vient déclaratif à double sens — le membre déclare, le trésorier confirme ; le trésorier déclare, le bénéficiaire confirme — est **la mécanique de confiance de tout le produit**. Chaque écriture engage deux personnes et reste visible de tout le groupe. C'est ce qui remplace le carnet, pas la jolie interface.

### Module 8 — Registre & preuves

- **Lisible par tous les membres**, pas seulement le président.
- Chaque écriture : qui, combien, quand, par quel canal, qui a enregistré, statut de confirmation.
- Filtres simples : par membre, par tour, par statut. Recherche.
- **« Inviolable » doit être justifié, pas affirmé.** Ce que le frontend doit montrer : écritures en lecture seule, aucune modification possible (uniquement des écritures d'annulation, elles-mêmes tracées), horodatage serveur affiché, et un **identifiant de vérification** par écriture. Si vous employez le mot « inviolable » dans l'interface, une page « Comment ça marche ? » doit l'expliquer en langage simple.
- **Export** : PDF (procès-verbal de fin de tour, format A4, prêt à imprimer et à signer — encore très demandé) et Excel. L'export PDF/Excel est **généré côté serveur**, pas dans le navigateur : embarquer `jsPDF` + `xlsx` côté client coûte plusieurs centaines de kilo-octets, incompatible avec les budgets du §11.
- Le PV de fin de tour est un livrable à part entière : il matérialise l'app dans le monde réel de la réunion.

### Module 9 — Retards, amendes et défaillance *(NOUVEAU)*

Le point aveugle le plus coûteux de la v1.0.

- **Échelle de relance** : rappel amical (J-2) → rappel (J) → relance (J+2) → amende (J+délai de grâce) → escalade au bureau.
- **Amendes** : calcul affiché de façon transparente, **application jamais silencieuse** (le président valide, le membre est notifié avec le motif), possibilité d'annuler avec motif (une tontine, c'est aussi de l'humain : un décès dans la famille annule l'amende).
- **Avance / remplacement** : un membre ne peut pas payer, un autre avance pour lui — enregistrer la dette entre membres. Cas très fréquent, jamais modélisé dans les apps concurrentes.
- **Défaillance après avoir pris la main** : statut « en défaut », gel des notifications automatiques, ouverture d'un dossier, journalisation. **L'app ne doit ni menacer, ni publier, ni « faire honte »** : elle fournit des preuves au bureau, c'est tout.
- **Sortie anticipée** : parcours de retrait avec calcul de ce qui est dû, et remplacement par un nouveau membre (avec reprise de rang).
- **Contestation** : bouton « signaler une erreur » sur chaque écriture, fil de discussion attaché, résolution tracée.

### Module 10 — Notifications et relances *(NOUVEAU, extrait du module 2 de la v1)*

La v1.0 promet des « rappels automatiques SMS/WhatsApp » dans le plan Standard. C'est le poste de coût le plus sous-estimé du projet.

| Canal | Réalité | Traitement frontend |
|:--|:--|:--|
| **Push PWA** | Gratuit, mais support iOS limité (app installée uniquement) | Canal par défaut ; écran d'incitation à l'installation |
| **Lien WhatsApp `wa.me`** | Gratuit, mais **manuel** : c'est l'humain qui envoie | Bouton « Relancer sur WhatsApp » avec message pré-rempli. **C'est le MVP.** |
| **WhatsApp Business API** | Payant au message, templates à faire approuver, fenêtre de 24 h | Ne pas le vendre dans la grille tarifaire tant que les templates ne sont pas validés |
| **SMS** | Payant, mais universel | Réservé aux événements critiques : OTP, versement reçu, confirmation cash |

Écran de préférences de notification par membre et par tontine, avec **plage horaire de silence** (ne pas envoyer de relance à 5 h du matin).

Message pré-rempli type, corrigé pour rester dans le vocabulaire local :

> « Bonjour Awa 👋 Petit rappel : ta cotisation de 10 000 FCFA pour la tontine *Les Battantes* est attendue avant vendredi. Tu peux payer ici : [lien] — Merci ! »

### Module 11 — Confiance et réputation (révisé)

La gamification de la v1.0 (score public 850/1000, badges « Payeur Or », accréditation « Expert ») pose trois problèmes : elle crée de fait un **fichier de scoring de crédit** sans cadre réglementaire, elle expose à la diffamation, et elle infantilise des adultes qui gèrent leur épargne.

**Ce qui est conservé :**
- **Historique factuel** : « 14 cotisations, 13 à l'heure, 3 tours complets terminés ». Des faits, pas une note.
- **Attestations vérifiables** : « Tour complet terminé — tontine *Les Battantes*, mars 2026 », partageable par le membre **s'il le décide**.
- Progression personnelle visible du membre seul.

**Ce qui est modifié :**
- Le score chiffré devient **privé par défaut**, partageable sur décision explicite du membre.
- Aucun classement public, aucune liste de mauvais payeurs, aucun badge négatif.
- Le président d'une tontine voit, au moment d'accepter une candidature, uniquement ce que le candidat a **choisi de partager**.
- Les termes « Débutant / Intermédiaire / Expert » sont supprimés : ils n'ont aucun sens pour de l'épargne.

**[À ARBITRER n°4]** — Si vous visez le marché B (§1.2), un vrai score devient nécessaire, mais il faut alors traiter la question du fichier de scoring et de l'ARTCI en amont, avec un juriste.

### Module 12 — Monétisation

La grille v1.0 (Gratuit / 2 500 / 7 500 FCFA par mois) appelle trois réserves :

1. **Qui paie ?** Un président de tontine de quartier ne débourse généralement rien de sa poche pour un outil de gestion. Le payeur naturel, c'est la caisse — donc une décision collective.
2. **L'abonnement récurrent est techniquement fragile** : le prélèvement automatique n'est pas garanti sur tous les rails (§2.3). Prévoir un paiement **manuel mensuel** avec relance, ou un paiement annuel remisé.
3. **La commission sur transaction** est plus alignée sur la valeur perçue — mais elle vous rapproche du statut d'établissement de paiement (§2.1). À valider juridiquement avant d'être affichée.

**[À ARBITRER n°5]** — Trois modèles à trancher : abonnement organisateur, frais de service par cotisation (100–200 FCFA, supportés par le membre ou la caisse), ou freemium sur le nombre de membres.

Côté interface, quel que soit le modèle : grille de tarifs lisible sans jargon, essai sans carte, **et surtout aucune fonctionnalité de sécurité derrière un paywall** (le registre, les preuves et les reçus doivent être gratuits — sinon vous vendez la confiance, ce qui se retourne toujours contre l'éditeur).

### Module 13 — Back-office *(nouveau, à spécifier séparément)*

Interface **distincte**, desktop-first : gestion des abonnements, vérification KYC/KYB, support, tableau de bord des transactions, gestion des litiges signalés, outils anti-fraude (détection de tontines fictives, de changements de numéro suspects). Ne pas le mélanger au code de l'app membre.

### Module 14 — Aide et support

Souvent oublié, mais déterminant sur ce marché : centre d'aide en langage simple, FAQ « Et si le président part avec l'argent ? » (répondez-y honnêtement), tutoriel de paiement par opérateur, **numéro WhatsApp de support visible**, et un mode « Comment ça marche » consultable **hors connexion**.

---

## 7. UX SPÉCIFIQUE AU TERRAIN IVOIRIEN

1. **Hors-ligne réel** — au-delà de la persistance Pinia : file d'attente de mutations (enregistrer un paiement cash sans réseau, synchroniser plus tard), bandeau d'état de connexion permanent, horodatage local + serveur, et **jamais de perte de saisie**. Indispensable pour le collecteur de tontine journalière au marché.
2. **Téléphone partagé** — plusieurs personnes utilisent le même appareil : verrouillage PIN, déconnexion rapide, pas de montants affichés sur l'écran de verrouillage ni dans les notifications (« Nouvelle activité sur ta tontine », pas « Tu as reçu 250 000 FCFA »).
3. **Faible littératie** — chaque statut porte **couleur + icône + mot**. Montants en gros. Icônes explicites plutôt que du texte fin. Envisager de courts **messages vocaux** générés pour les rappels (à tester avant d'investir).
4. **Data saver** — images WebP/AVIF, `loading="lazy"`, avatars générés en SVG à partir des initiales (zéro requête), aucune police distante, aucune bibliothèque d'animation lourde, pas de vidéo sur la landing.
5. **Appareils d'entrée de gamme** — cible de test : Android 9+, 2 Go de RAM, Chrome. Tester sur un appareil réel, pas seulement dans l'émulateur.
6. **Retour de paiement** — l'utilisateur qui quitte l'app pour Wave et revient doit retrouver **exactement** son contexte. Route de retour `/paiement/retour` avec reprise d'état.

---

## 8. ROUTES NUXT (RÉVISÉES)

| Route | Accès | Description |
|:--|:--|:--|
| `/` | Public | Landing, pré-rendue |
| `/tarifs` | Public | Grille tarifaire |
| `/aide`, `/aide/[slug]` | Public | Centre d'aide, consultable hors-ligne |
| `/legal/cgu`, `/legal/confidentialite` | Public | Obligatoire avant inscription |
| `/login` | Public | Numéro + OTP |
| `/join/[token]` | Public → Auth | **Aperçu de l'invitation avant connexion** |
| `/dashboard` | Auth | Vue unifiée : mes tontines (membre et bureau) |
| `/tontine/create` | Auth | Wizard |
| `/tontine/[id]` | Membre | Détail, cycle en cours |
| `/tontine/[id]/membres` | Membre | Liste, statuts, rangs |
| `/tontine/[id]/registre` | Membre | **Registre complet, lecture pour tous** |
| `/tontine/[id]/cotiser` | Membre | Récapitulatif + choix du moyen |
| `/tontine/[id]/cotiser/[rail]` | Membre | Parcours spécifique opérateur |
| `/tontine/[id]/versement` | Trésorier | **Décaissement du pot** |
| `/tontine/[id]/reglages` | Président | Configuration |
| `/tontine/[id]/impayes` | Bureau | Retards, amendes, dossiers |
| `/paiement/retour` | Auth | Retour de redirection externe |
| `/recu/[id]` | Public (lien signé) | Vérification d'un reçu |
| `/profile` | Auth | Historique, attestations |
| `/profile/donnees` | Auth | Export / suppression (RGPD-like, loi 2013-450) |
| `/abonnement` | Président | Gestion de l'abonnement |
| `/admin/**` | Super-admin | Back-office séparé |

**Middlewares :** `auth` (session), `role` (par tontine, pas globalement), `kyc-palier` (redirige vers la complétion du palier requis), `tontine-active` (état du cycle).

**États à couvrir sur chaque écran** — à traiter comme des livrables, pas comme des cas limites : chargement (squelette, pas de spinner plein écran), vide (« Aucune tontine pour l'instant » + action), erreur réseau (avec bouton réessayer), hors-ligne (données en cache + bandeau), accès refusé.

---

## 9. ACCESSIBILITÉ & INTERNATIONALISATION

- Contraste **WCAG AA** vérifié sur toute la palette (la palette v1.0 échouait sur l'orange `#FF6B00` en texte).
- Navigation clavier et lecteur d'écran sur les parcours critiques (paiement, versement).
- **Aucune information portée par la couleur seule.**
- Support du zoom d'affichage système jusqu'à 200 % sans casse de mise en page.
- `@nuxtjs/i18n` dès le départ, toutes les chaînes externalisées. Langue de lancement : français. À évaluer ensuite : anglais (diaspora), et messages audio en dioula/baoulé plutôt que traduction textuelle intégrale — la traduction écrite dans ces langues a une utilité limitée pour le public visé.

---

## 10. RESPONSIVE

- Plancher : **320 px** (et non 375 px). Tester à 320, 360, 390, 430 px et en tablette.
- Zone de pouce : les actions primaires en bas d'écran, pas en haut.
- Barre d'action fixe en bas sur les écrans de paiement.
- Desktop : mise en page à deux colonnes à partir de `lg`, sans refonte — utile pour le président qui travaille sur ordinateur.

---

## 11. PERFORMANCE — CRITÈRES CORRIGÉS

> **Le critère v1.0 « score Lighthouse ≥ 90 sur l'audit PWA » n'est plus réalisable : la catégorie PWA a été retirée de Lighthouse en version 12 (avril–mai 2024), à la suite de la mise à jour des critères d'installabilité de Chrome.** Un prestataire ne peut donc pas livrer ce score.

**Critères de remplacement :**

| Critère | Seuil |
|:--|:--|
| Lighthouse **Performance** (mobile, throttling par défaut) | ≥ 90 sur `/`, ≥ 85 sur `/dashboard` |
| Lighthouse **Accessibilité** | ≥ 95 |
| Lighthouse **Bonnes pratiques** / **SEO** (landing) | ≥ 95 |
| LCP (terrain, p75) | < 2,5 s |
| INP (terrain, p75) | < 200 ms |
| CLS | < 0,1 |
| JS initial (compressé) | **< 180 Ko** |
| Poids total premier chargement | **< 250 Ko** hors images |
| Navigation ultérieure | < 40 Ko |
| Chargement complet en 3G réelle (test terrain Abidjan) | < 5 s |

**Installabilité PWA** — vérifiée par checklist manuelle, Lighthouse ne l'audite plus : manifeste valide, icônes 192/512 + maskable, `display: standalone`, service worker enregistré, installation testée sur Chrome Android **et** Safari iOS (ajout à l'écran d'accueil), fonctionnement hors-ligne des écrans mis en cache.

**Contrôle continu :** budget de performance appliqué en CI (Lighthouse CI), build en échec si un budget est dépassé.

---

## 12. LIVRABLES ET CRITÈRES DE RECETTE

1. **Maquettes** : tous les écrans aux 5 largeurs de référence, **incluant les états vides, de chargement, d'erreur et hors-ligne**.
2. **Design system** documenté : tokens, composants, règles d'usage des couleurs opérateurs.
3. **Code source** : dépôt Git, conventions Nuxt 4, TypeScript strict, Zod partagé.
4. **Tests** : unitaires sur les calculs (montants, amendes, rotation, parts multiples — zéro tolérance d'erreur), E2E Playwright sur les 4 parcours critiques (inscription, rejoindre, cotiser, verser).
5. **Recette d'intégration PrimeVue 4 / Tailwind 4** : capture de l'ordre des couches CSS, aucune régression de style sur les 20 composants utilisés.
6. **Rapport de performance** conforme au §11, mesures incluses sur appareil réel d'entrée de gamme.
7. **Test utilisateur** : 5 organisateurs et 5 membres réels à Abidjan, en conditions réelles de réseau, avant la mise en production. C'est le seul livrable qui dira si le produit fonctionne.
8. **Documentation d'exploitation** : variables d'environnement, configuration des rails de paiement, procédure de bascule en mode dégradé.

---

## 13. DÉCOUPAGE MVP / V2

| MVP (viser 8–12 semaines) | V1.5 | Plus tard |
|:--|:--|:--|
| Auth OTP, palier KYC 0–1 | **KYC palier 2 + tontines ouvertes (marché B)** | Enchères |
| Rejoindre par lien, membre géré | Notifications WhatsApp API | Score partageable |
| Création rotative privée + parts multiples | **Réconciliation auto via Wave Business (N2)** | Tontine journalière, caisse de solidarité |
| **Paiement déclaratif Wave + espèces** | Canaux OM / MTN / Moov | PI-SPI |
| Registre + reçus + PV PDF | Amendes automatiques, avances | Multi-pays UEMOA |
| Versement du pot + accusé de réception | Litiges structurés | Back-office avancé |
| Relance WhatsApp manuelle | Abonnement | |

---

## 14. POINTS À ARBITRER (RESTANTS)

**Tranchés en v2.1 :** flux d'argent (traceur pur, Wave direct), marché (les deux, régimes séparés), modèle (rotative classique).

**Encore ouverts :**

1. **Score de confiance** : privé et factuel (recommandé) ou visible par les organisateurs ? L'ouverture du marché B rend un signal de réputation plus utile — mais aussi plus risqué juridiquement. À trancher avec un juriste, pas seul.
2. **Monétisation** : abonnement organisateur, frais de service facturé séparément, ou freemium sur le nombre de membres ? **Attention** : le prélèvement d'un pourcentage sur la cotisation est à écarter (§2.1, garde-fou n°2).
3. **Partenariat Wave Business** : à engager tôt. Toute la valeur du produit en dépend, et une intégration officielle change aussi votre crédibilité commerciale.
4. **Séquencement du marché B** : dès le lancement, ou après une première cohorte d'organisateurs avec historique ? La recommandation de ce document est d'attendre.

---

## 15. LES TROIS RISQUES À SURVEILLER

1. **L'écart entre le déclaré et le réel.** Tant que la réconciliation est manuelle, un trésorier peut confirmer un paiement qui n'a pas eu lieu, ou l'inverse. Le produit ne supprime pas la fraude : il la rend traçable et attribuable. Le dire honnêtement dans la communication vaut mieux que promettre l'inviolabilité.
2. **La friction du parcours déclaratif.** Sortir de l'app, payer, revenir, déclarer : c'est quatre étapes là où un checkout intégré en demanderait une. Si le taux d'abandon entre « Ouvrir Wave » et « J'ai envoyé » dépasse 30 %, la connexion Wave Business n'est plus une option de V1.5, c'est une urgence. **Instrumentez cette conversion dès le premier jour.**
3. **Le premier incident.** Un organisateur partira avec un pot. Ce n'est pas une hypothèse, c'est une certitude statistique. Préparez **avant le lancement** : la procédure de signalement, la réponse publique, les CGU qui délimitent votre rôle, et l'export de preuves que vous pourrez remettre aux membres lésés. Une application de tontine qui découvre ce sujet le jour où il arrive ne s'en relève pas.

---

## SOURCES CONSULTÉES

- BCEAO — Instruction n°001-01-2024 du 23 janvier 2024 relative aux services de paiement dans l'UMOA
- BCEAO — PI-SPI : lancement du 30 septembre 2025 et prolongation des délais de connexion (juin 2026) — https://pispi.bceao.int
- ARTCI — Nouveau plan national de numérotation (préfixes mobiles 01 / 05 / 07)
- Orange Côte d'Ivoire — codes Orange Money, dont `#144*82#` (code OTP) ; Orange Developer — Orange Money Web Payment
- Loi ivoirienne n°2013-450 relative à la protection des données à caractère personnel
- Google / Chrome — retrait de la catégorie PWA dans Lighthouse 12 (changelog Lighthouse, notes de version PageSpeed Insights)
- PrimeVue — documentation d'intégration Tailwind CSS (plugin `tailwindcss-primeui`, version CSS pour Tailwind 4) ; Volt pour Nuxt
- Panorama concurrentiel : Maman Tontine, Djangui, E-Tontine, SmartMifin
