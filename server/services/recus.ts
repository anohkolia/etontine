import { createHmac, timingSafeEqual } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { useDb } from '../db/index.ts'
import {
  contributions, memberships, paymentDeclarations, rounds, tontines, users,
} from '../db/schema.ts'
import { formatMoney } from '../../shared/format/money.ts'
import { apiError } from '../utils/errors.ts'

type Db = ReturnType<typeof useDb>

/** Durée de validité d'un lien de reçu. */
export const VALIDITE_JOURS = 30

function secret(): string {
  return process.env.NUXT_SESSION_SECRET || 'secret-de-developpement-non-secret'
}

/**
 * Signe un lien de reçu.
 *
 * Le reçu est consultable **sans compte** : on le partage par WhatsApp, et
 * celui qui le reçoit n'est pas forcément membre. Une adresse devinable
 * laisserait donc n'importe qui parcourir les reçus en essayant des
 * identifiants. La signature lie l'identifiant à une date d'expiration, et les
 * deux sont vérifiés ensemble — signer sans expiration reviendrait à publier le
 * reçu pour toujours.
 */
export function signerRecu(declarationId: string, expiration: Date): string {
  return createHmac('sha256', secret())
    .update(`${declarationId}:${expiration.getTime()}`)
    .digest('base64url')
}

export function lienRecu(declarationId: string, base: string): { url: string, expiresAt: Date } {
  const expiresAt = new Date(Date.now() + VALIDITE_JOURS * 86_400_000)
  const signature = signerRecu(declarationId, expiresAt)

  return {
    url: `${base}/recu/${declarationId}?exp=${expiresAt.getTime()}&sig=${signature}`,
    expiresAt,
  }
}

/** Vérifie une signature, en temps constant, et refuse un lien expiré. */
export function verifierSignature(declarationId: string, exp: string, sig: string): void {
  const horodatage = Number(exp)

  if (!Number.isFinite(horodatage)) {
    throw apiError('NOT_FOUND', 'Ce lien de reçu n’est pas valable.')
  }

  if (horodatage < Date.now()) {
    throw apiError('NOT_FOUND', 'Ce lien de reçu a expiré. Demande-en un nouveau au bureau.')
  }

  const attendue = Buffer.from(signerRecu(declarationId, new Date(horodatage)))
  const fournie = Buffer.from(sig)

  if (attendue.length !== fournie.length || !timingSafeEqual(attendue, fournie)) {
    throw apiError('NOT_FOUND', 'Ce lien de reçu n’est pas valable.')
  }
}

export interface Recu {
  id: string
  amount: number
  channel: string
  confirmedAt: string | null
  declaredAt: string
  tontineName: string
  roundIndex: number
  memberName: string
  status: 'confirmed' | 'pending' | 'rejected'
}

/**
 * Données d'un reçu.
 *
 * **Strictement quatre informations** : montant, date, tontine, membre
 * (acceptation T18). Rien sur les autres membres, rien sur l'état du pot, rien
 * sur qui doit encore. Un reçu circule par WhatsApp, souvent dans des groupes
 * qui débordent du cercle de la tontine ; il ne doit pas devenir une fuite
 * d'information sur le groupe.
 */
export function recu(db: Db, declarationId: string): Recu {
  const [ligne] = db
    .select({
      declaration: paymentDeclarations,
      roundIndex: rounds.index,
      tontineName: tontines.name,
      managedName: memberships.managedName,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(paymentDeclarations)
    .innerJoin(contributions, eq(contributions.id, paymentDeclarations.contributionId))
    .innerJoin(rounds, eq(rounds.id, contributions.roundId))
    .innerJoin(tontines, eq(tontines.id, rounds.tontineId))
    .innerJoin(memberships, eq(memberships.id, contributions.membershipId))
    .leftJoin(users, eq(users.id, memberships.userId))
    .where(eq(paymentDeclarations.id, declarationId))
    .limit(1)
    .all()

  if (!ligne) throw apiError('NOT_FOUND', 'Reçu introuvable.')

  return {
    id: declarationId,
    amount: ligne.declaration.amount,
    channel: ligne.declaration.channel,
    declaredAt: ligne.declaration.declaredAt.toISOString(),
    confirmedAt: ligne.declaration.decidedAt?.toISOString() ?? null,
    tontineName: ligne.tontineName,
    roundIndex: ligne.roundIndex,
    memberName: [ligne.firstName, ligne.lastName].filter(Boolean).join(' ')
      || ligne.managedName
      || 'Membre',
    status: ligne.declaration.decision === 'confirmed'
      ? 'confirmed'
      : ligne.declaration.decision === 'rejected' ? 'rejected' : 'pending',
  }
}

const MOIS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]

function dateLisible(iso: string): string {
  const d = new Date(iso)
  return `${d.getUTCDate()} ${MOIS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

function echapper(texte: string): string {
  return texte
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Reçu au format image, pour le partage.
 *
 * En **SVG** : quelques kilo-octets, net à toutes les tailles, et lisible sur
 * l'écran d'entrée de gamme comme sur une impression. Un rendu matriciel
 * pèserait dix fois plus pour un résultat moins net, et exigerait un moteur de
 * rendu de polices côté serveur.
 *
 * La police est celle du système (`system-ui`), conformément à la règle 16 :
 * aucune police n'est embarquée, ce qui garde le fichier minuscule.
 */
export function recuSvg(donnees: Recu): string {
  const confirme = donnees.status === 'confirmed'
  const etat = confirme ? 'Cotisation confirmée' : 'Cotisation déclarée'
  const couleurEtat = confirme ? '#065f46' : '#1e3a8a'
  const fondEtat = confirme ? '#d1fae5' : '#dbeafe'

  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="380" viewBox="0 0 600 380" role="img" aria-label="Reçu de cotisation">
<style>
.t{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.l{font-size:15px;fill:#52525b}
.v{font-size:19px;font-weight:600;fill:#18181b}
</style>
<rect width="600" height="380" rx="16" fill="#ffffff" stroke="#d4d4d8"/>
<text class="t" x="32" y="52" font-size="14" fill="#6d6d76" letter-spacing="1.5">REÇU DE COTISATION</text>
<text class="t" x="32" y="92" font-size="30" font-weight="700" fill="#18181b">${echapper(formatMoney(donnees.amount))}</text>
<rect x="32" y="112" width="${Math.min(320, etat.length * 9 + 28)}" height="30" rx="15" fill="${fondEtat}"/>
<text class="t" x="46" y="132" font-size="14" font-weight="600" fill="${couleurEtat}">${etat}</text>
<line x1="32" y1="168" x2="568" y2="168" stroke="#e4e4e7"/>
<text class="t l" x="32" y="200">Tontine</text>
<text class="t v" x="32" y="226">${echapper(donnees.tontineName)}</text>
<text class="t l" x="32" y="262">Membre</text>
<text class="t v" x="32" y="288">${echapper(donnees.memberName)}</text>
<text class="t l" x="330" y="200">Tour</text>
<text class="t v" x="330" y="226">${donnees.roundIndex}</text>
<text class="t l" x="330" y="262">Date</text>
<text class="t v" x="330" y="288">${echapper(dateLisible(donnees.confirmedAt ?? donnees.declaredAt))}</text>
<line x1="32" y1="316" x2="568" y2="316" stroke="#e4e4e7"/>
<text class="t" x="32" y="344" font-size="13" fill="#6d6d76">eTontine — reçu vérifiable en ligne</text>
</svg>`
}
