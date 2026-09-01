# Canaux de collecte, détail et réglages d'une tontine

Trois écrans qui manquaient. Deux tickets, écrits l'un après l'autre parce que
le second dépend du premier : on ne peut pas changer le numéro de collecte
d'une tontine sans écran pour en créer un.

---

## 1. Ce qui manquait, et comment on ne l'a pas vu

**`POST /me/channels` n'était appelé par aucune page.** L'API existait, sa
vérification par OTP aussi, `tests/unit/canaux.spec.ts` les couvrait. Une seule
page touchait à cette route, et en lecture seule : le wizard listait les canaux
**déjà vérifiés**. Quand la liste était vide, il affichait « Ajoute le numéro
sur lequel tu recevras les cotisations » — un impératif sans bouton.

Conséquence : **un organisateur qui venait de s'inscrire ne pouvait pas créer
de tontine.** Le parcours s'arrêtait à l'étape « Argent ».

Les 126 tests de bout en bout passaient par-dessus, parce que leur helper crée
le canal en tapant l'API directement (`tests/e2e/helpers/session.ts`,
`canalVerifie`). C'est le bon choix pour des tests qui éprouvent autre chose —
mais il ne restait alors **aucun** test pour cette porte d'entrée.

**`/app/tontine/[id]` et `/app/tontine/[id]/reglages` n'existaient pas**, alors
qu'ils ouvrent la cartographie des routes du §8. Les cartes du tableau de bord
pointaient vers le registre : on tombait sur la comptabilité au lieu de l'état
du tour.

Le second manquait de façon mesurable : `services/canaux.ts` notifie tous les
membres vers `/app/tontine/:id/reglages` à chaque changement de canal. **Un
lien mort dans une notification poussée.** Et la règle 22 — re-vérification
OTP, notification à tous, gel de 48 h — était implémentée et testée côté
serveur sans aucune interface pour la déclencher.

---

## 2. Les écrans

### `/app/profil/canaux`

Dans le profil et non dans le wizard : un canal appartient à **l'utilisateur**
(`/me/channels`), pas à une tontine. L'enfermer dans le wizard obligerait à le
ressaisir à chaque création.

- Le **titulaire est obligatoire**, et l'écran dit pourquoi : c'est ce nom que
  le membre compare à ce qu'affiche son application de paiement (T14).
- L'ajout **enchaîne sur la vérification**. Un canal non vérifié ne sert à
  rien ; le faire retrouver dans la liste serait une étape pour rien.
- Le code part **sur le numéro de collecte lui-même**, pas sur celui du compte.
  C'est ce qui prouve que l'organisateur contrôle ce numéro : on peut déclarer
  le numéro de n'importe qui.
- Un canal non vérifié reste listé, avec la phrase qui va avec : « ce numéro ne
  peut pas recevoir les cotisations d'une tontine ».
- `?redirect=` ramène à l'intention initiale — le wizard, ou les réglages.
  Filtré aux adresses internes, comme sur l'écran de connexion.

### `/app/tontine/[id]`

Le cycle en cours, lisible par **tout membre**. Un seul appel peint l'écran.

`GET /tontines/:id` renvoyait déjà les réglages, le tour courant et le pot
attendu ; il lui manquait le pot **collecté** et ce que je dois. Ces deux
calculs vivaient en clair dans `services/tableau-de-bord.ts` : ils sont
remontés dans `services/tours.ts` (`etatDuTour`) et les deux appelants s'en
servent. Deux implémentations d'un même calcul d'argent finissent toujours par
diverger — et c'est le genre de divergence qu'on découvre sur un pot.

Le brouillon a son propre bloc, avec la liste de ce qui bloque encore la
publication plutôt qu'un écran vide.

### `/app/tontine/[id]/reglages`

Président. Le serveur l'imposait déjà ; l'écran ne fait que ne pas proposer un
formulaire qui serait refusé — et affiche un état « réservé au président »
plutôt qu'une erreur, parce que ce n'en est pas une.

Trois zones :

1. **Présentation** — nom, icône, quartier, description. Le nom est figé après
   publication : il figure dans les invitations déjà envoyées et sur les reçus
   déjà émis.
2. **Numéro de collecte** — et l'avertissement de la règle 22, affiché **avant**
   de valider. Après, les 48 h courent déjà et tous les membres ont été
   notifiés. Le texte dit pourquoi c'est bruyant : « c'est le geste que
   reproduirait quelqu'un ayant pris la main sur ton compte. »
3. **Argent et règles** — en lecture seule dès le démarrage, avec la raison
   écrite : les modifier réécrirait des cotisations déjà calculées, et pour
   certaines déjà versées.

---

## 3. Navigation

`TontineTabs` gagne « La tontine » en premier onglet et « Réglages » en
dernier, ce dernier pour le président seulement. Le titre des cartes du tableau
de bord mène désormais au détail, plus au registre.

---

## 4. Tests

`tests/e2e/canaux.spec.ts` passe **par l'interface**, jamais par l'API. C'est
le garde-fou : si ajouter un numéro redevient impossible depuis l'application,
c'est là que ça casse. Il rejoue aussi le trou d'origine de bout en bout —
wizard sans canal, ajout, vérification, retour au brouillon intact.

`tests/e2e/tontine-detail.spec.ts` couvre le détail (un seul appel, jauge,
montant dû), le changement de canal avec son gel et son écriture au registre,
et le refus opposé au membre simple.

Sur ce dernier point, une précision utile : **rejoindre par lien une tontine
déjà lancée laisse en `pending_approval`**, et `requireMembership` refuse. Le
membre simple d'une tontine en cours est donc un membre que le président avait
ajouté avant le démarrage, et qui se fait rattacher en ouvrant son compte avec
le numéro enregistré (T12). Le test le joue ainsi, sinon il ne prouverait rien.
