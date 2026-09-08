# Modèle de données et machines à états

Périmètre MVP : **tontine rotative uniquement**. Les autres modèles restent hors interface.

---

## 1. Entités

### `users`
| Champ | Type | Note |
|:--|:--|:--|
| `id` | uuid | |
| `phone` | text unique | E.164, `+225XXXXXXXXXX` |
| `first_name`, `last_name` | text | |
| `avatar_url` | text? | |
| `kyc_level` | int 0–3 | voir §4 |
| `pin_hash` | text? | verrouillage app |
| `phone_changed_at` | timestamp? | déclenche le gel de 48 h sur les versements |
| `plan_tier` | `free\|standard\|plus` | palier d'abonnement, défaut `free`. Porte sur la **personne**, jamais sur la tontine |
| `plan_until` | timestamp? | fin des droits. Périmé, le palier retombe au gratuit **au calcul** — aucune tâche planifiée à faire tourner |
| `created_at` | timestamp | |

### `collection_channels` — canaux de collecte d'un organisateur
| Champ | Type | Note |
|:--|:--|:--|
| `id` | uuid | |
| `user_id` | uuid → users | |
| `provider` | enum `wave\|orange\|mtn\|moov` | |
| `msisdn` | text | E.164 |
| `holder_name` | text | affiché au membre pour vérification anti-arnaque |
| `payment_link_url` | text? | lien Wave si fourni |
| `verified_at` | timestamp? | **null = inutilisable**, OTP obligatoire |

### `tontines`
| Champ | Type | Note |
|:--|:--|:--|
| `id` | uuid | |
| `name`, `description`, `avatar_url`, `locality` | | |
| `emoji` | text? | Icône choisie dans une liste fermée (`shared/constants/tontine.ts`). Purement présentationnel : modifiable même tontine lancée |
| `access` | enum `private\|open` | `open` exige `kyc_level >= 2` du créateur |
| `share_amount` | integer | FCFA, entier |
| `frequency` | enum `daily\|weekly\|biweekly\|monthly` | |
| `start_date` | date | |
| `rotation_mode` | enum `draw\|fixed` | |
| `fees_bearer` | enum `member\|tontine` | |
| `penalty_amount` | integer | 0 = pas d'amende |
| `penalty_period` | enum `once\|per_day` | |
| `penalty_cap` | integer? | |
| `grace_days` | int | |
| `status` | enum — voir §2.1 | |
| `created_by` | uuid → users | |

`tontine_channels` : table de liaison `tontine_id × collection_channel_id`.

### `memberships`
| Champ | Type | Note |
|:--|:--|:--|
| `id` | uuid | |
| `tontine_id` | uuid | |
| `user_id` | uuid? | **null pour un membre géré** |
| `managed_name`, `managed_phone` | text? | renseignés si `user_id` est null |
| `role` | enum `president\|treasurer\|auditor\|member` | **par tontine, jamais global** |
| `status` | enum — voir §2.2 | |
| `joined_at` | timestamp | |

> Un `user_id` null + `managed_phone` renseigné = membre sans application. Quand il confirme son lien SMS, on crée le `user` et on rattache le `membership`. **Ne jamais dupliquer l'historique** lors de ce rattachement.

### `shares` — les parts
| Champ | Type | Note |
|:--|:--|:--|
| `id` | uuid | |
| `membership_id` | uuid | |
| `rotation_position` | int | unique par tontine |

> Une part = une position dans la rotation = un tour où l'on prend la main. Un membre à double part possède **deux** lignes. Toute la logique de rotation raisonne sur `shares`, jamais sur `memberships`. C'est la source d'erreur n°1 : ne pas la contourner.

### `rounds` — les tours
| Champ | Type | Note |
|:--|:--|:--|
| `id` | uuid | |
| `tontine_id` | uuid | |
| `index` | int | 1..n |
| `due_date` | date | |
| `beneficiary_share_id` | uuid → shares | |
| `expected_amount` | integer | `share_amount × nb_shares_total` |
| `status` | enum — voir §2.3 | |

### `contributions` — une ligne par part et par tour
| Champ | Type | Note |
|:--|:--|:--|
| `id` | uuid | |
| `round_id`, `share_id`, `membership_id` | uuid | |
| `expected_amount` | integer | |
| `confirmed_amount` | integer | somme des déclarations confirmées, 0 par défaut |
| `status` | enum — voir §2.4 | |
| `due_date` | date | |

> Le bénéficiaire du tour **cotise aussi** dans la plupart des tontines ivoiriennes. Générer sa contribution comme les autres ; le net lui revient au versement. Ne pas l'exclure de la génération.

### `payment_declarations`
| Champ | Type | Note |
|:--|:--|:--|
| `id` | uuid | |
| `contribution_id` | uuid | |
| `declared_by` | uuid → users | membre ou trésorier |
| `source` | enum `member\|treasurer\|system` | `system` réservé à la future réconciliation Wave Business |
| `amount` | integer | paiements partiels autorisés |
| `channel` | enum `wave\|orange\|mtn\|moov\|cash` | |
| `provider_ref` | text? | référence de transaction |
| `proof_url` | text? | capture, < 100 Ko |
| `declared_at` | timestamp | |
| `decision` | enum `pending\|confirmed\|rejected` | |
| `decided_by` | uuid? | |
| `decided_at` | timestamp? | |
| `rejection_reason` | text? | **obligatoire si `rejected`** |
| `escalated_at` | timestamp? | posé automatiquement à +48 h sans décision |

### `payouts` — versement du pot
| Champ | Type | Note |
|:--|:--|:--|
| `id` | uuid | |
| `round_id` | uuid unique | |
| `beneficiary_membership_id` | uuid | |
| `amount` | integer | |
| `channel` | enum | |
| `provider_ref`, `proof_url` | text? | |
| `prepared_by`, `counter_validated_by`, `declared_by` | uuid? | |
| `acknowledged_at` | timestamp? | accusé de réception du bénéficiaire |
| `status` | enum — voir §2.5 | |

### `ledger_entries` — registre, append-only
| Champ | Type | Note |
|:--|:--|:--|
| `id` | uuid | |
| `tontine_id`, `round_id?` | uuid | |
| `type` | enum `contribution_declared\|contribution_confirmed\|contribution_rejected\|penalty_applied\|penalty_waived\|payout_declared\|payout_acknowledged\|member_joined\|member_left\|rotation_changed\|settings_changed\|reversal` | |
| `actor_id` | uuid | qui a agi |
| `payload` | jsonb | données figées au moment de l'écriture |
| `prev_hash`, `hash` | text | chaînage par tontine |
| `server_timestamp` | timestamp | horloge serveur, jamais celle du client |

> `hash = sha256(prev_hash + type + actor_id + canonical_json(payload) + server_timestamp)`. Une écriture erronée n'est jamais modifiée : on ajoute une écriture `reversal` qui référence l'originale. Exposer un endpoint de vérification de chaîne.

### Autres
- `penalties` : `contribution_id`, `amount`, `status` `applied|waived`, `reason`, `applied_by`.
- `advances` : `round_id`, `from_membership_id`, `to_membership_id`, `amount`, `settled_at?` — un membre avance pour un autre. Cas fréquent, à ne pas oublier.
- `disputes` : `ledger_entry_id`, `opened_by`, `status` `open|resolved`, fil de messages.
- `invites` : `token`, `tontine_id`, `expires_at`, `max_uses`, `used_count`.
- `notification_preferences` : par utilisateur et par tontine, avec `quiet_hours_start/end`.
- `subscription_requests` : `user_id`, `tier`, `periodicity` `monthly|yearly`, `price_fcfa` (figé à la création — la grille peut bouger avant la décision), `status` `pending|approved|rejected`, `reviewed_by/at`, `review_note`. L'application n'encaisse rien : une demande est une intention, tranchée à la main depuis le back-office.

---

## 2. Machines à états

Toute transition non listée ici est **interdite** et doit renvoyer `409 INVALID_TRANSITION`.

### 2.1 `tontines.status`
```
draft ──(publier)──> open ──(démarrer)──> running ──(dernier tour clos)──> closed ──> archived
  │                    │
  └──(supprimer)       └──(annuler)──> archived
```
- `draft` → `open` : exige ≥ 1 canal de collecte vérifié, montant et fréquence définis.
- `open` → `running` : exige ≥ 3 memberships actifs et un ordre de rotation figé. **Après cette transition, l'ordre de rotation ne peut plus changer sans contre-validation du censeur et écriture au registre.**

### 2.2 `memberships.status`
```
invited ──> pending_approval ──> active ──> left
                                    │
                                    └──> defaulted
```
- `defaulted` : posé manuellement par le président, uniquement après un tour où le membre a déjà pris la main. Gèle les relances automatiques. **N'entraîne aucune publication publique.**

### 2.3 `rounds.status`
```
pending ──> collecting ──> payout_pending ──> closed
```
- `collecting` → `payout_pending` : toutes les contributions confirmées, **ou** le président force en assumant un pot incomplet (écriture au registre avec le montant manquant).
- `payout_pending` → `closed` : uniquement après `payouts.status = acknowledged`. **Pas de clôture sans accusé de réception du bénéficiaire.**

### 2.4 `contributions.status`
```
due ──(déclaration)──> declared ──(confirmation)──> confirmed
 │                        │
 │                        └──(rejet)──> disputed ──> due | confirmed
 └──(due_date + grace_days dépassés, tâche planifiée)──> late ──(déclaration)──> declared
```

| Transition | Acteur autorisé |
|:--|:--|
| `due|late → declared` | le membre lui-même, ou le trésorier (espèces / membre géré) |
| `declared → confirmed` | trésorier ou président — **jamais l'auteur de la déclaration** |
| `declared → disputed` | trésorier (rejet, motif obligatoire) ou membre (si déclaré par le trésorier) |
| `disputed → confirmed | due` | président ou censeur, après résolution |

Règle de séparation : `payment_declarations.declared_by ≠ decided_by`. À vérifier côté serveur, pas côté client.

**Repli, et un seul : le bureau d'une seule personne.** Quand l'organisateur cumule les rôles — cas courant d'une petite tontine —, la règle n'a personne à qui confier la décision : la cotisation de l'organisateur resterait bloquée en `declared` à chaque tour, il serait en retard chez lui-même et le pot toujours incomplet. Sa déclaration est alors confirmée d'office, et l'écriture `contribution_confirmed` porte `autoConfirmee: true` avec le motif — le registre doit distinguer une cotisation vérifiée par un tiers d'une cotisation validée par son auteur faute de tiers.

Le repli est **dérivé des données, jamais d'un drapeau de l'appelant** : le serveur constate qu'aucune adhésion active de rôle président ou trésorier, autre que le déclarant, ne porte de compte. Dès qu'un second membre de bureau existe, la règle reprend d'elle-même. Il ne s'étend pas à la déclaration d'un membre ordinaire, qui a un valideur — le président — et l'attend.

Ce qui justifie le repli n'est pas la commodité : c'est qu'il n'y a rien à vérifier. L'argent que l'organisateur cotise part sur son propre canal de collecte, aucun tiers ne le voit passer. Le contrôle réel est en aval, à l'accusé de réception du bénéficiaire (§2.5), qui lui reste réservé au bénéficiaire.

### 2.5 `payouts.status`
```
prepared ──> counter_validated ──> declared ──> acknowledged
                                       │
                                       └──> disputed ──> declared
```
- `counter_validated` : requis si `amount > seuil` (configurable par tontine, défaut 100 000 FCFA). Acteur : président ou censeur, **différent** de celui qui a préparé.
- `declared → acknowledged` : **seul le bénéficiaire** peut poser cet état.

### 2.6 `subscription_requests.status`
```
pending ──> approved
   │
   └──> rejected
```
- Les deux états décidés sont **finaux** : on refait une demande, on ne rouvre pas l'ancienne. Le back-office garde ainsi qui a décidé quoi, et quand.
- Acteur : administrateur du back-office uniquement, et la décision est écrite dans `admin_audit`.
- `approved` pose `plan_tier` et `plan_until` sur le président. Renouveler le **même** palier prolonge les droits en cours ; changer de palier repart de la date de décision.

---

## 3. Matrice de permissions

| Action | Membre | Trésorier | Président | Censeur |
|:--|:--:|:--:|:--:|:--:|
| Lire le registre complet | ✅ | ✅ | ✅ | ✅ |
| Déclarer sa propre cotisation | ✅ | ✅ | ✅ | ✅ |
| Déclarer pour un autre (espèces) | ❌ | ✅ | ✅ | ❌ |
| Confirmer une déclaration | ❌ | ✅ | ✅ | ❌ |
| Appliquer / annuler une amende | ❌ | ❌ | ✅ | ❌ |
| Préparer un versement | ❌ | ✅ | ✅ | ❌ |
| Contre-valider un versement | ❌ | ❌ | ✅ | ✅ |
| Accuser réception du pot | ✅ (bénéficiaire seul) | — | — | — |
| Modifier l'ordre de rotation | ❌ | ❌ | ✅ + contre-validation | ✅ (contre-valide) |
| Inviter / exclure un membre | ❌ | ❌ | ✅ | ❌ |
| Modifier les canaux de collecte | ❌ | ❌ | ✅ + OTP + gel 48 h | ❌ |
| Ouvrir une contestation | ✅ | ✅ | ✅ | ✅ |
| Exporter le registre (PDF/Excel) | ✅ (sa tontine) | ✅ | ✅ | ✅ |

Le rôle est **par tontine**. Un même utilisateur est président ici et simple membre ailleurs.

---

## 4. Paliers KYC

| Palier | Déclencheur | Exigé |
|:--|:--|:--|
| 0 | Inscription | Numéro vérifié par OTP |
| 1 | Rejoindre une tontine | Nom complet |
| 2 | Créer une tontine, ou publier une tontine **ouverte** | Pièce d'identité + selfie |
| 3 | Volume élevé | Justificatif d'activité, contrat signé |

Middleware `kyc-palier` : redirige vers la complétion du palier manquant en conservant l'intention initiale (`?redirect=`).

---

## 5. Règles de calcul — à couvrir par des tests unitaires

1. **Montant attendu d'un tour** = `share_amount × total_shares` (toutes parts confondues, bénéficiaire inclus).
2. **Ordre de rotation** : liste ordonnée de `shares` par `rotation_position`. Avec le mode `draw`, le tirage est effectué **côté serveur**, la graine et le résultat sont figés dans une écriture `rotation_changed` horodatée — c'est la preuve anti-soupçon.
3. **Double part** : le membre apparaît deux fois dans la rotation, à deux positions distinctes, et cotise deux fois par tour.
4. **Amende** : `once` → montant fixe une fois le délai de grâce dépassé. `per_day` → `penalty_amount × jours de retard`, plafonné à `penalty_cap`. Jamais appliquée automatiquement sans validation du président.
5. **Pot net versé** = `expected_amount − contributions non confirmées` si le président force le versement. Le manquant est écrit au registre, pas masqué.
