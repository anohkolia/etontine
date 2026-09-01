# Monétisation — arbitrage

Point 2 des « à arbitrer » de `docs/cahier-des-charges.md` §14, que `CLAUDE.md`
interdit de trancher seul. Tranché par le commanditaire le 2026-09-02, en
partie : ce document dit ce qui est décidé et ce qui manque encore pour écrire
`/tarifs` et `/abonnement`.

---

## 1. Décidé

**Trois paliers, forfaitaires : Gratuit · 7 500 F · 10 000 F.**

Un forfait et non une commission sur les cotisations. C'est ce qu'exige le
garde-fou n°2 du §2.1 : prélever un pourcentage sur l'argent des membres
rapprocherait l'éditeur du statut d'établissement de paiement, avec le cadre
BCEAO qui va avec.

**La limite porte sur les deux axes à la fois** : nombre de tontines actives
**et** nombre de membres par tontine.

**Le président paie de sa poche.** La caisse n'est pas débitée, et
l'application ne propose aucun mécanisme pour la faire payer — cohérent avec la
règle 5, l'application ne touche jamais aux fonds du groupe.

Le §12 signale que ce choix est le plus exposé commercialement : un président
de tontine de quartier ne débourse généralement rien personnellement pour un
outil de gestion. C'est une décision de produit assumée, pas un oubli.

---

## 2. Contrainte non négociable, appliquée sans nouvelle validation

**Aucune fonctionnalité de sécurité derrière le paywall** (§6 module 12) :
le registre, les preuves, les reçus, le contrôle d'intégrité et le
procès-verbal PDF restent **gratuits à tous les paliers**. « Sinon vous vendez
la confiance, ce qui se retourne toujours contre l'éditeur. »

Conséquence directe : la grille du template est inutilisable telle quelle. Ses
arguments payants sont « encaissements Mobile Money automatisés » — qui
n'existe pas dans l'architecture v2.1 — et « rapport de gestion exportable
Excel / PDF », qui doit rester gratuit.

---

## 3. Encore ouvert — bloque l'écriture des écrans

| Question | État |
|:--|:--|
| Les seuils chiffrés de chaque palier (combien de tontines, combien de membres) | **manquant** |
| Périodicité et mode de paiement | remis à plus tard par le commanditaire |

Sur le mode de paiement, le §12 pose une contrainte technique à ne pas perdre
de vue au moment de trancher : le prélèvement automatique récurrent n'est pas
garanti sur les rails ivoiriens (§2.3). Les deux options praticables sont un
**paiement manuel mensuel avec relance**, ou un **paiement annuel remisé**.

Tant que les seuils manquent, `/tarifs` et `/abonnement` ne sont pas écrites :
une grille sans chiffres n'est pas une grille, et les inventer est exactement
ce que `CLAUDE.md` interdit.
