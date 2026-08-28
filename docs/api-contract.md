# Contrat d'API — routes serveur Nitro

Base : `/api/v1`. Toutes les entrées et sorties sont validées par les schémas Zod de `shared/schemas/`.

---

## Conventions

**Authentification** : cookie de session `httpOnly`, `SameSite=Lax`, `Secure`. Pas de JWT en `localStorage`.

**Format d'erreur — unique dans toute l'API :**
```json
{ "error": { "code": "INVALID_TRANSITION", "message": "…", "field": "status" } }
```

Codes : `UNAUTHENTICATED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `VALIDATION_ERROR` (422), `INVALID_TRANSITION` (409), `IDEMPOTENCY_CONFLICT` (409), `KYC_REQUIRED` (403, avec `requiredLevel`), `RATE_LIMITED` (429).

**Idempotence** : header `Idempotency-Key` **obligatoire** sur toutes les créations liées à l'argent (`declare`, `confirm`, `payout`). Rejeu de la même clé sous 24 h → renvoie la réponse d'origine, ne crée rien. Clé absente → `422`.

**Montants** : entiers, en FCFA. Jamais de flottant, jamais de chaîne.

**Pagination** : `?cursor=&limit=` (défaut 20, max 100). Réponse `{ items: [], nextCursor: string | null }`.

**Rôles** : résolus côté serveur à partir du `membership` de l'appelant dans la tontine concernée. Le client n'envoie jamais son rôle.

---

## Authentification

| Méthode | Route | Description |
|:--|:--|:--|
| `POST` | `/auth/otp/request` | `{ phone }` → envoie l'OTP. Rate limit 3/10 min/numéro. Renvoie toujours 200 (pas d'énumération de comptes) |
| `POST` | `/auth/otp/verify` | `{ phone, code }` → session + `{ user, isNewUser }` |
| `POST` | `/auth/otp/voice` | Fallback appel vocal après 2 échecs SMS |
| `POST` | `/auth/logout` | |
| `GET` | `/auth/me` | Utilisateur courant + memberships (id, tontineId, role) |
| `POST` | `/auth/pin` | Définir/changer le code PIN |

---

## Profil et KYC

| Méthode | Route | Description |
|:--|:--|:--|
| `PATCH` | `/me` | Prénom, nom, avatar |
| `POST` | `/me/kyc` | Upload pièce + selfie → palier 2, statut `pending_review` |
| `GET` | `/me/export` | Export des données personnelles (loi n°2013-450) |
| `DELETE` | `/me` | Demande de suppression. **Refusée si l'utilisateur a des tours en cours** — renvoyer la liste des blocages, pas un refus opaque |
| `GET` | `/me/channels` · `POST` · `DELETE /:id` | Canaux de collecte |
| `POST` | `/me/channels/:id/verify` | OTP sur le numéro de collecte. **Tant que `verified_at` est null, le canal n'est pas utilisable** |

---

## Tontines

| Méthode | Route | Description |
|:--|:--|:--|
| `GET` | `/tontines` | Mes tontines, avec `myRole`, `nextDueDate`, `myContributionStatus` — assez pour peindre le tableau de bord **en un appel** |
| `POST` | `/tontines` | Création (brouillon). Exige KYC ≥ 2 |
| `GET` | `/tontines/:id` | Détail + tour courant + progression du pot |
| `PATCH` | `/tontines/:id` | Réglages. Refusé si `status = running` sauf champs autorisés (description, avatar) |
| `POST` | `/tontines/:id/publish` | `draft → open`. Vérifie canal de collecte vérifié |
| `POST` | `/tontines/:id/start` | `open → running`. Fige la rotation, génère tous les `rounds` et `contributions` |
| `POST` | `/tontines/:id/rotation` | Ordre fixe ou tirage. Tirage effectué **côté serveur**, graine + résultat écrits au registre |
| `GET` | `/tontines/:id/members` | Avec `shares`, `rotationPosition`, statut du tour courant |
| `POST` | `/tontines/:id/members` | Ajout d'un membre géré `{ name, phone, shares }` |
| `PATCH` | `/tontines/:id/members/:mid` | Rôle, nombre de parts, statut |
| `DELETE` | `/tontines/:id/members/:mid` | Sortie avec calcul de ce qui est dû |
| `POST` | `/tontines/:id/invites` | → `{ token, url, expiresAt }` |
| `GET` | `/invites/:token` | **Public**. Aperçu avant connexion : nom, président, montant, fréquence, nb membres |
| `POST` | `/invites/:token/accept` | Auth requise → `membership` en `pending_approval` |

---

## Tours et cotisations

| Méthode | Route | Description |
|:--|:--|:--|
| `GET` | `/tontines/:id/rounds` | Liste, avec le tour courant marqué |
| `GET` | `/rounds/:id` | Détail + toutes les contributions |
| `GET` | `/rounds/:id/contributions` | Filtres `?status=` |
| `GET` | `/contributions/:id/payment-info` | **Écran « où envoyer »** : canal, msisdn, `holderName`, `paymentLinkUrl`, référence courte générée, montant attendu, frais estimés, `feesBearer` |
| `POST` | `/contributions/:id/declare` | `{ amount, channel, providerRef?, proofUrl? }` → `declared`. Idempotence obligatoire |
| `POST` | `/contributions/:id/declare-cash` | Trésorier, pour un tiers → `declared`, notification de confirmation au membre |
| `POST` | `/declarations/:id/confirm` | Trésorier/président → `confirmed`. Refusé si `declared_by = caller` |
| `POST` | `/declarations/:id/reject` | `{ reason }` obligatoire → `disputed` |
| `POST` | `/declarations/bulk-confirm` | `{ ids: [] }` — le « tout confirmer » du trésorier |
| `GET` | `/tontines/:id/pending-confirmations` | La file du trésorier |

**Upload de preuve** : `POST /uploads/proof` (multipart) → `{ url }`. Le serveur **rejette au-delà de 200 Ko** ; le client compresse avant.

---

## Versement du pot

| Méthode | Route | Description |
|:--|:--|:--|
| `GET` | `/rounds/:id/payout` | Écran de préparation : pot constitué / attendu, manquants, bénéficiaire, `msisdn`, alerte si `phone_changed_at` < 48 h |
| `POST` | `/rounds/:id/payout/prepare` | `prepared`. Renvoie si une contre-validation est requise |
| `POST` | `/rounds/:id/payout/counter-validate` | Président ou censeur, ≠ préparateur |
| `POST` | `/rounds/:id/payout/declare` | `{ channel, providerRef?, proofUrl? }` → `declared` |
| `POST` | `/rounds/:id/payout/acknowledge` | **Bénéficiaire uniquement** → `acknowledged`, clôture le tour |
| `POST` | `/rounds/:id/close` | Force la clôture (président, cas exceptionnel, écriture au registre) |

---

## Registre, amendes, litiges

| Méthode | Route | Description |
|:--|:--|:--|
| `GET` | `/tontines/:id/ledger` | Paginé, filtres `?roundId=&memberId=&type=`. **Accessible à tout membre actif** |
| `GET` | `/tontines/:id/ledger/verify` | Vérification de la chaîne de hachage → `{ valid, brokenAt? }` |
| `GET` | `/tontines/:id/export?format=pdf\|xlsx` | **Génération serveur.** PDF = procès-verbal A4 prêt à signer |
| `GET` | `/receipts/:id` | Reçu vérifiable. Lien signé, consultable sans compte |
| `GET` | `/receipts/:id/image` | Image < 40 Ko pour partage WhatsApp |
| `POST` | `/contributions/:id/penalty` | Application d'une amende (président) |
| `POST` | `/penalties/:id/waive` | `{ reason }` — annulation |
| `POST` | `/advances` | `{ roundId, fromMembershipId, toMembershipId, amount }` |
| `POST` | `/ledger/:entryId/dispute` | Bouton « signaler une erreur » |
| `POST` | `/disputes/:id/messages` · `POST /disputes/:id/resolve` | |

---

## Notifications

| Méthode | Route | Description |
|:--|:--|:--|
| `GET`/`PATCH` | `/me/notification-preferences` | Par tontine, avec plage de silence |
| `POST` | `/push/subscribe` | Abonnement Web Push |
| `GET` | `/tontines/:id/reminders/whatsapp` | Renvoie les liens `wa.me` **pré-remplis** pour les retardataires. L'envoi reste manuel — c'est le MVP, ne pas simuler un envoi automatique |

---

## Tâches planifiées (Nitro tasks)

| Tâche | Fréquence | Effet |
|:--|:--|:--|
| `mark-late` | horaire | `due → late` après `due_date + grace_days` |
| `escalate-declarations` | horaire | Pose `escalated_at` sur les déclarations en attente > 48 h, notifie le bureau, rend l'alerte visible au registre |
| `unconfirmed-cash` | quotidienne | Marque « non confirmée par le membre » après 72 h |
| `due-reminders` | quotidienne | Rappels J-2 et J, en respectant les plages de silence |
| `open-next-round` | quotidienne | Passe le tour suivant en `collecting` |

---

## Cartographie des routes client

| Route | Accès | Écrans |
|:--|:--|:--|
| `/` | Public | Landing, pré-rendue |
| `/tarifs`, `/aide`, `/legal/*` | Public | |
| `/login` | Public | Numéro + OTP |
| `/join/[token]` | Public → auth | Aperçu de l'invitation **avant** connexion |
| `/app` | Auth | Tableau de bord |
| `/app/tontine/create` | KYC 2 | Wizard (brouillon sauvegardé à chaque étape) |
| `/app/tontine/[id]` | Membre | Détail, tour courant |
| `/app/tontine/[id]/membres` | Membre | |
| `/app/tontine/[id]/registre` | Membre | Registre complet |
| `/app/tontine/[id]/cotiser` | Membre | Récap → où envoyer → déclaration |
| `/app/tontine/[id]/confirmations` | Trésorier | File de confirmation |
| `/app/tontine/[id]/versement` | Trésorier | Préparation → déclaration |
| `/app/tontine/[id]/impayes` | Bureau | Retards, amendes, dossiers |
| `/app/tontine/[id]/reglages` | Président | |
| `/app/profil`, `/app/profil/donnees` | Auth | |
| `/recu/[id]` | Lien signé | Vérification publique |
| `/admin/**` | Super-admin | **Application distincte, hors périmètre MVP** |

**Middlewares** : `auth`, `role` (résolu par tontine), `kyc-palier`, `tontine-status`.
