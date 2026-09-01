# Refonte visuelle — reprise du template

Le dossier `template/` contient une maquette React/Vite (shadcn/ui, générée par
Lovable) proposée comme référence de design. Ce document dit ce qui en a été
repris, ce qui a été écarté, et pourquoi.

---

## 1. Le point de départ

La maquette est bien meilleure que l'interface livrée sur trois plans :
en-tête en dégradé qui donne une identité, navigation basse à portée de pouce,
et cartes flottantes qui séparent l'information au lieu de l'aligner.

Elle a en revanche été écrite **contre la version 1.0 du cahier des charges**.
On y trouve un score de confiance sur 1000, des badges, une grille
d'abonnement, un paiement Mobile Money « en 1 clic » et le mot « ramassage » —
tous supprimés ou interdits par la v2.1. La reprise porte donc sur le
**langage visuel**, pas sur le modèle produit.

---

## 2. Ce qui est repris

| Élément | Où | Note |
|:--|:--|:--|
| Palette (nuit, émeraude, orange, surfaces froides) | `app/assets/css/main.css` | oklch converti en hexadécimal, deux teintes assombries pour tenir le AA |
| `gradient-trust`, `gradient-pot`, `card-surface`, `tabular` | idem, en `@utility` | |
| En-tête collant en dégradé, avec retour et avatar | `app/layouts/app.vue` | titre déclaré par la page via `useEnTete()` |
| Barre d'onglets basse | idem | §10 : les actions primaires dans la zone du pouce |
| Jauge circulaire du pot | `PotGauge.vue` | |
| Tuiles de chiffres | `StatTile.vue` | |
| Titre de section avec action | `SectionTitle.vue` | |
| Pastilles d'opérateur | `CanalPill.vue` + `PAYMENT_CHANNEL` | |
| Onglets d'une tontine | `TontineTabs.vue` | adaptés en **liens**, pas en état local |
| Cartes sélectionnables pour le canal | `OuEnvoyer.vue` | |
| Rang de rotation en pastille | écran Membres | |
| Barre d'étapes segmentée | wizard, connexion | |
| Préfixe `+225` affiché | connexion | |
| Icône de tontine (emoji) | colonne `tontines.emoji` | voir §5 |
| « Akwaba » en accueil | tableau de bord | |

---

## 3. Ce qui est écarté, et pourquoi

**Les polices Sora et Plus Jakarta Sans.** Règle 16 : police système, aucune
police téléchargée. Le caractère « titre » vient du poids et d'un crénage à
-0.02em sur `h1`–`h4`. Coût réseau : zéro.

**Le score de confiance sur 1000, les badges, l'accréditation
« Débutant / Intermédiaire / Expert ».** Le §6 module 11 du cahier les supprime
nommément : une note chiffrée sur quelqu'un qui épargne constitue un fichier de
scoring de crédit sans cadre réglementaire, et expose à la diffamation. La
carte de profil affiche à la place l'état de vérification d'identité — un fait,
pas une note.

**La grille tarifaire (Gratuit / 2 500 / 7 500 F) et l'onglet « Abonnement ».**
Le modèle de monétisation fait partie de ce que `CLAUDE.md` interdit de
trancher seul. L'onglet « Aide » prend la place dans la barre basse.

**Le paiement « en 1 clic », le push USSD, la confirmation automatique.** Ils
contredisent l'architecture v2.1 : l'application ne détient jamais de fonds et
ne voit aucun flux. Le membre envoie, puis **déclare** ; le trésorier
**confirme**. L'écran de paiement du template affiche « Payer 25 000 FCFA » et
« Paiement confirmé 🎉 » 1,6 seconde plus tard — c'est un mensonge sur ce que
le produit sait.

**Le vocabulaire.** « Ramassage », « journal de caisse », « encaisser » :
interdits par les règles 8 et 9. « Registre inviolable » aussi, pour une autre
raison — le registre est **vérifiable**, il n'est pas inviolable, et promettre
l'inviolabilité est précisément le genre de phrase qui se retourne au premier
incident (§15 du cahier).

**Les chiffres de traction de la landing** (« 12 400+ membres », « 380 M F
collectés »). Ils sont inventés. Trois faits vérifiables les remplacent : rien
n'est détenu, toutes les écritures sont chaînées, le premier chargement tient
sous 250 Ko.

**Le dégradé du pot sous du texte.** Le template pose du blanc sur
`gradient-pot` — avatar de profil, bouton d'appel à l'action. L'extrémité
orange du dégradé donne 2.89:1 avec du blanc : sous le seuil AA, et illisible
en plein soleil, qui est le cas d'usage. `gradient-pot` ne sert donc plus
qu'aux aplats sans texte (barres de progression) ; un second utilitaire,
`gradient-brand` (émeraude → émeraude foncée), porte le texte. Ses deux arrêts
sont des tokens dont le contraste est vérifié par test.

**Les couleurs de pastille d'opérateur telles quelles.** Le template pose du
blanc sur l'orange d'Orange Money (3.12:1) et du bleu nuit sur le jaune MTN
(1.53:1). Une pastille de canal se lit à côté d'un montant, dans un registre
qu'on relit pour vérifier un envoi : fond pâle, encre foncée, comme les
statuts.

---

## 4. Ce qui a été corrigé en chemin

**L'ordre du tableau de bord.** Le template ouvre sur ses tuiles de chiffres.
L'acceptation T21 exige « à traiter aujourd'hui » **en premier** : un membre
ouvre l'application pour savoir quoi faire, pas pour consulter. Les tuiles
viennent après.

**Les tuiles ne comptent pas d'argent.** Le template additionne les cotisations
de toutes les tontines côté client. Additionner des dus dans le navigateur est
exactement ce que la règle 2 interdit. Les deux tuiles comptent des **actions**
et des **tontines**, pas des francs.

**Le `<h1>` de la landing.** Il portait la marque ; il porte maintenant la
promesse. Le nom reste dans la barre de navigation.

---

## 5. L'icône de tontine — la seule addition au modèle de données

Colonne `tontines.emoji`, nullable, migration `0005` avec sa descente.

Ce n'est pas de la décoration. Sur une liste de trois tontines, l'image se
repère avant le nom — et l'écart se creuse pour quelqu'un qui lit lentement
(§7 du cahier, faible littératie). La pastille retombe sur la première lettre
du nom quand aucune icône n'est choisie : elle n'est jamais vide.

Deux garde-fous :

- **Liste fermée de huit valeurs**, pas de texte libre. Un champ libre
  accepterait un caractère de contrôle bidirectionnel ou une chaîne de trois
  cents octets qui casserait toutes les listes qui l'affichent.
- **La liste vit dans `shared/constants/tontine.ts`**, pas dans
  `shared/schemas/`. Le schéma la reprend (`z.enum(TONTINE_EMOJIS)`), donc la
  source de vérité reste unique — mais le wizard peut l'afficher sans importer
  Zod dans le lot client. Aucune page n'importe de valeur depuis les schémas ;
  huit caractères ne devaient pas être la première exception.

L'icône est modifiable même tontine lancée : elle ne touche aucun montant ni
aucun statut.

---

## 6. Coût mesuré

| Mesure | Avant | Après | Budget |
|:--|--:|--:|--:|
| JS initial compressé | 110,4 Ko | 112,6 Ko | 180 Ko |
| Premier chargement | 117,7 Ko | 123,5 Ko | 250 Ko |
| Navigation la plus lourde | 10,1 Ko | 10,1 Ko | 40 Ko |

Le contrôle de contraste passe de 22 à 45 paires : les canaux, l'accent et les
trois arrêts du dégradé d'en-tête y sont entrés.

---

## 7. Reste ouvert

Les deux premiers manques listés ici ont été comblés depuis, dans deux tickets
séparés : voir [`T-canaux-et-reglages.md`](./T-canaux-et-reglages.md).

- **L'historique factuel du membre** (« 14 cotisations, 13 à l'heure ») que le
  §6 module 11 conserve n'a ni API ni écran. Le template le remplaçait par des
  badges ; ce n'est pas un remplacement.
- **`@nuxtjs/i18n` et Vee-Validate** restent absents alors que `CLAUDE.md` les
  impose. La refonte a ajouté des chaînes en dur, elle n'a pas créé l'écart.
