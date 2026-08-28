import { randomUUID } from 'node:crypto'
import { and, eq, isNotNull } from 'drizzle-orm'
import type { useDb } from '../db/index.ts'
import { collectionChannels, tontineChannels, tontines } from '../db/schema.ts'
import { apiError } from '../utils/errors.ts'
import { appendLedger } from './ledger.ts'
import { notifierTontine } from './notifications.ts'

type Db = ReturnType<typeof useDb>

/** Gel imposé après un changement de canal sur une tontine active (règle 22). */
export const GEL_HEURES = 48

/**
 * Rattache un canal de collecte à une tontine.
 *
 * **Un canal non vérifié ne peut pas être rattaché** (acceptation T09). La
 * vérification est un OTP envoyé sur le numéro de collecte lui-même : elle
 * prouve que l'organisateur contrôle bien ce numéro. Sans elle, n'importe qui
 * pourrait faire collecter les cotisations du groupe sur le sien — c'est
 * l'arnaque la plus simple et la plus rentable contre une tontine.
 */
export function rattacherCanal(db: Db, tontineId: string, channelId: string, acteurId: string) {
  const [canal] = db
    .select()
    .from(collectionChannels)
    .where(eq(collectionChannels.id, channelId))
    .limit(1)
    .all()

  if (!canal) throw apiError('NOT_FOUND', 'Canal de collecte introuvable.')

  if (!canal.verifiedAt) {
    throw apiError(
      'FORBIDDEN',
      'Ce numéro de collecte n’est pas encore vérifié. Vérifie-le par SMS avant de le rattacher.',
      { field: 'channelId' },
    )
  }

  const [tontine] = db.select().from(tontines).where(eq(tontines.id, tontineId)).limit(1).all()
  if (!tontine) throw apiError('NOT_FOUND', 'Tontine introuvable.')

  const dejaRattaches = db
    .select()
    .from(tontineChannels)
    .where(eq(tontineChannels.tontineId, tontineId))
    .all()

  // Sur une tontine déjà lancée, changer de canal est le geste que reproduirait
  // un escroc ayant pris la main sur un compte. On ne l'interdit pas — un
  // organisateur change parfois de numéro pour de bonnes raisons — mais on le
  // rend bruyant et lent.
  const tontineActive = tontine.status === 'running'
  const changement = tontineActive && dejaRattaches.length > 0

  const frozenUntil = changement
    ? new Date(Date.now() + GEL_HEURES * 60 * 60 * 1000)
    : null

  db.insert(tontineChannels)
    .values({ tontineId, channelId, frozenUntil })
    .run()

  if (changement) {
    appendLedger(db, {
      tontineId,
      type: 'settings_changed',
      actorId: acteurId,
      payload: {
        changement: 'canal_de_collecte',
        provider: canal.provider,
        holderName: canal.holderName,
        // Les quatre derniers chiffres suffisent à reconnaître le numéro sans
        // l'exposer en clair dans un registre que tout le monde lit.
        msisdnFin: canal.msisdn.slice(-4),
        gelJusquau: frozenUntil?.toISOString(),
      },
    })

    notifierTontine(db, tontineId, {
      type: 'canal_modifie',
      title: 'Changement de numéro de collecte',
      body: 'Le numéro où envoyer les cotisations a changé. Vérifie-le avant ton prochain envoi.',
      url: `/app/tontine/${tontineId}/reglages`,
    })
  }

  return { channelId, frozenUntil }
}

/** Les canaux vérifiés et utilisables d'une tontine. */
export function canauxDeTontine(db: Db, tontineId: string) {
  return db
    .select({
      id: collectionChannels.id,
      provider: collectionChannels.provider,
      msisdn: collectionChannels.msisdn,
      holderName: collectionChannels.holderName,
      paymentLinkUrl: collectionChannels.paymentLinkUrl,
      frozenUntil: tontineChannels.frozenUntil,
    })
    .from(tontineChannels)
    .innerJoin(collectionChannels, eq(collectionChannels.id, tontineChannels.channelId))
    .where(and(
      eq(tontineChannels.tontineId, tontineId),
      isNotNull(collectionChannels.verifiedAt),
    ))
    .all()
}

/** Crée un canal, non vérifié : inutilisable tant qu'il ne l'est pas. */
export function creerCanal(db: Db, userId: string, input: {
  provider: 'wave' | 'orange' | 'mtn' | 'moov'
  msisdn: string
  holderName: string
  paymentLinkUrl?: string
}) {
  const id = randomUUID()
  db.insert(collectionChannels).values({
    id,
    userId,
    provider: input.provider,
    msisdn: input.msisdn,
    // Obligatoire : c'est ce que le membre lit dans son application de paiement
    // pour vérifier qu'il envoie bien à la bonne personne (T14).
    holderName: input.holderName,
    paymentLinkUrl: input.paymentLinkUrl ?? null,
    verifiedAt: null,
  }).run()

  return id
}

export function marquerVerifie(db: Db, channelId: string) {
  db.update(collectionChannels)
    .set({ verifiedAt: new Date() })
    .where(eq(collectionChannels.id, channelId))
    .run()
}
