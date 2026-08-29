# Back-office — vérification d'identité

Hors des 27 tickets du backlog. Traité parce qu'il constituait le dernier
blocage pour une mise en production : sans lui, `POST /me/kyc` laisse le
dossier en `pending_review` et le palier 2 n'est jamais accordé — donc aucune
tontine n'est publiable.

---

## 1. Ce qui est fait, ce qui ne l'est pas

Le module 13 du cahier des charges couvre : abonnements, vérification KYC/KYB,
support, tableau de bord des transactions, litiges, outils anti-fraude. Il est
lui-même marqué « à spécifier séparément ».

**Fait :** la vérification d'identité — file d'attente, examen des pièces,
approbation, rejet motivé, journal des décisions.

**Pas fait, et pourquoi :**

- **Abonnements** — dépend du modèle de monétisation, que `CLAUDE.md` interdit
  de trancher seul.
- **Support, tableau de bord, anti-fraude** — non spécifiés. Les construire
  reviendrait à inventer des règles sur des données d'argent.

---

## 2. Architecture

Application Nuxt **distincte**, dans `admin/`, avec sa propre configuration,
son propre build et **son propre serveur Nitro**.

C'est plus strict que l'esquisse initiale, qui plaçait les routes
d'administration dans le serveur des membres. La différence est réelle : le
serveur des membres n'expose **aucune** route d'administration — un test le
vérifie. Le compromettre ne donne aucun accès aux dossiers d'identité.

Ce qui est partagé l'est délibérément, et seulement ce qui doit l'être :

| Partagé | Pourquoi |
|:--|:--|
| `shared/schemas` | Dupliquer une source de vérité sur des états d'argent est ce que CLAUDE.md interdit |
| `server/db`, `server/services` | Même raison : une seule implémentation des règles métier |
| `app/components/ui`, `app/composables`, le thème CSS | Une seule définition de `<StatusBadge>` et de `useMoney()` |

Le back-office est **desktop-first**, contrairement à l'application des
membres : on examine une pièce d'identité sur un écran large. Ses tests de bout
en bout ne sont donc pas rejoués à 360 px.

---

## 3. Comment quelqu'un devient administrateur

Le statut vient d'une **liste blanche de numéros en variable
d'environnement** — `NUXT_ADMIN_PHONES` — et jamais d'une colonne en base.

La propriété recherchée : **une compromission de la base de données ne donne
pas les droits d'administration**. Quelqu'un qui obtiendrait un accès en
écriture à `users` pourrait se déclarer président de n'importe quelle tontine ;
il ne pourrait pas pour autant approuver une pièce d'identité.

Le revers est assumé : ajouter un administrateur demande un redéploiement. Sur
une équipe qui se compte sur les doigts d'une main, c'est un prix dérisoire.

**Amorçage.** Le back-office ne crée aucun compte — laisser un point d'entrée
d'administration créer des comptes est le genre de commodité qui finit mal. La
ligne doit donc exister avant la première connexion :

```bash
NUXT_ADMIN_PHONES="+2250707000001" pnpm db:admin
```

La commande est idempotente et n'accorde **aucun droit** : elle ouvre la porte
à quelqu'un qui a déjà la clé.

---

## 4. Ce qui est journalisé

Tout, dans `admin_audit`, en append-only comme le registre :

- les approbations et les rejets, avec leur motif ;
- **les consultations de pièces**. Regarder la pièce d'identité de quelqu'un
  est une action, pas une lecture anodine : c'est la donnée la plus sensible
  que l'application détient. Le journal ne l'empêche pas, il la rend traçable —
  et c'est cette traçabilité qui dissuade de fouiller par curiosité.

Le numéro de l'administrateur est **figé au moment de l'écriture** : s'il en
change plus tard, le journal reste lisible tel qu'il était.

Le journal est consultable par tout administrateur, y compris pour ses propres
actions — un journal que seul son auteur peut relire ne contrôle rien.

---

## 5. Défauts trouvés en chemin

**Les pièces déposées n'étaient servies par aucune route.** `POST /uploads/proof`
renvoyait une adresse que rien ne desservait : le lien « Voir la capture » du
trésorier tombait en 404 depuis T15, et l'administrateur n'aurait rien pu
examiner. La route manquante est ajoutée, avec son contrôle d'accès — le
déposant et le bureau d'une tontine partagée, personne d'autre.

**Le chemin des pièces n'était pas gardé.** Un motif fermé remplace tout
filtrage de `..` : seuls un UUID et une extension connue passent, et le chemin
résolu est revérifié contre la racine. Filtrer les `..` d'un chemin fourni par
l'appelant est un jeu qu'on perd — encodages, séparateurs alternatifs,
normalisation Unicode.

**Le dépôt et le dossier d'identité ne parlaient pas le même langage.**
`POST /uploads/proof` rend un chemin relatif, `POST /me/kyc` valide une URL
absolue : un client conforme aux deux stockait une adresse que le back-office
ne savait pas décomposer. Symptôme : un 404, rien d'autre.

**La page de détail ne chargeait jamais son dossier** — l'appel au montage
manquait. Trouvé parce que le test a été rendu strict : la première version,
avec des branches conditionnelles, passait sans rien vérifier.

---

## 6. Ce qui change côté membre

`POST /me/kyc` garde ses deux comportements — approbation immédiate hors
production, `pending_review` en production — mais la conséquence n'est plus la
même : le dossier a désormais un examinateur. Une tontine peut être publiée en
production.

Les tests du back-office placent eux-mêmes un dossier en attente pour éprouver
le parcours d'examen, que l'approbation automatique masquerait autrement.
