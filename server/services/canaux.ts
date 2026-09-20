import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
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
 * Le numéro de collecte n'est plus prouvé par SMS. Ce qui protège les membres
 * contre l'arnaque la plus simple — faire collecter les cotisations du groupe
 * sur un autre numéro — tient à trois choses : le code d'accès est redemandé
 * pour déclarer un numéro, le nom du titulaire est affiché au membre au
 * moment de payer (T09), et tout changement sur une tontine lancée est
 * bruyant et gelé quarante-huit heures (règle 22).
 */
export async function rattacherCanal(db: Db, tontineId: string, channelId: string, acteurId: string) {
  const [canal] = await db
    .select()
    .from(collectionChannels)
    .where(eq(collectionChannels.id, channelId))
    .limit(1)

  if (!canal) throw apiError('NOT_FOUND', 'Canal de collecte introuvable.')

  const [tontine] = await db.select().from(tontines).where(eq(tontines.id, tontineId)).limit(1)
  if (!tontine) throw apiError('NOT_FOUND', 'Tontine introuvable.')

  const dejaRattaches = await db
    .select()
    .from(tontineChannels)
    .where(eq(tontineChannels.tontineId, tontineId))

  // Sur une tontine déjà lancée, changer de canal est le geste que reproduirait
  // un escroc ayant pris la main sur un compte. On ne l'interdit pas — un
  // organisateur change parfois de numéro pour de bonnes raisons — mais on le
  // rend bruyant et lent.
  const tontineActive = tontine.status === 'running'
  const changement = tontineActive && dejaRattaches.length > 0

  const frozenUntil = changement
    ? new Date(Date.now() + GEL_HEURES * 60 * 60 * 1000)
    : null

  await db.insert(tontineChannels)
    .values({ tontineId, channelId, frozenUntil })

  if (changement) {
    await appendLedger(db, {
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

    await notifierTontine(db, tontineId, {
      type: 'canal_modifie',
      title: 'Changement de numéro de collecte',
      body: 'Le numéro où envoyer les cotisations a changé. Vérifie-le avant ton prochain envoi.',
      url: `/app/tontine/${tontineId}/reglages`,
    })
  }

  return { channelId, frozenUntil }
}

/** Les canaux de collecte d'une tontine. */
export async function canauxDeTontine(db: Db, tontineId: string) {
  return await db
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
    .where(eq(tontineChannels.tontineId, tontineId))
}

/** Crée un canal de collecte. */
export async function creerCanal(db: Db, userId: string, input: {
  provider: 'wave' | 'orange' | 'mtn' | 'moov'
  msisdn: string
  holderName: string
  paymentLinkUrl?: string
}) {
  const id = randomUUID()
  await db.insert(collectionChannels).values({
    id,
    userId,
    provider: input.provider,
    msisdn: input.msisdn,
    // Obligatoire : c'est ce que le membre lit dans son application de paiement
    // pour vérifier qu'il envoie bien à la bonne personne (T14).
    holderName: input.holderName,
    paymentLinkUrl: input.paymentLinkUrl ?? null,
  })

  return id
}
