import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm'
import type { useDb } from '../db/index.ts'
import {
  contributions, memberships, notificationPreferences, rounds, shares, tontines, users,
} from '../db/schema.ts'
import { notifier } from './notifications.ts'

type Db = ReturnType<typeof useDb>

/** Jours avant l'échéance où l'on relance. J-2, puis le jour même. */
export const JOURS_DE_RAPPEL = [2, 0]

export interface PlageDeSilence {
  start: number | null
  end: number | null
}

/**
 * Une notification tombe-t-elle dans la plage de silence ?
 *
 * Les plages traversent minuit dans la vraie vie — « 21 h à 7 h » est le cas
 * courant. Comparer bêtement `start <= minute <= end` donnerait toujours faux
 * pour ces plages-là, et les rappels partiraient en pleine nuit. Or une
 * notification à 2 h du matin sur un téléphone partagé, c'est la famille
 * réveillée et l'application désinstallée le lendemain.
 */
export function estEnSilence(plage: PlageDeSilence, minuteDuJour: number): boolean {
  const { start, end } = plage
  if (start === null || end === null) return false
  if (start === end) return false

  return start < end
    ? minuteDuJour >= start && minuteDuJour < end
    : minuteDuJour >= start || minuteDuJour < end // la plage traverse minuit
}

/** Les minutes écoulées depuis minuit, dans le fuseau du serveur. */
export function minuteDuJour(instant: Date): number {
  return instant.getHours() * 60 + instant.getMinutes()
}

/** Les préférences d'un membre pour une tontine, avec repli sur ses réglages généraux. */
export function preferencesDe(db: Db, userId: string, tontineId: string) {
  const lignes = db
    .select()
    .from(notificationPreferences)
    .where(and(
      eq(notificationPreferences.userId, userId),
      or(eq(notificationPreferences.tontineId, tontineId), isNull(notificationPreferences.tontineId)),
    ))
    .all()

  // Le réglage propre à la tontine l'emporte sur le réglage général.
  const specifique = lignes.find(l => l.tontineId === tontineId)
  const general = lignes.find(l => l.tontineId === null)

  return specifique ?? general ?? {
    pushEnabled: true,
    remindersEnabled: true,
    quietHoursStart: null as number | null,
    quietHoursEnd: null as number | null,
  }
}

export interface RappelEnvoye {
  userId: string
  tontineId: string
  joursAvant: number
}

/**
 * Envoie les rappels de cotisation, à J-2 et le jour de l'échéance.
 *
 * Deux rappels, pas dix : au-delà, la relance devient du harcèlement et le
 * membre coupe les notifications — après quoi on ne peut plus le joindre du
 * tout, y compris pour ce qui compte.
 *
 * Les plages de silence sont respectées **par membre** : quelqu'un qui dort le
 * jour parce qu'il travaille la nuit peut décaler la sienne.
 */
export function envoyerRappels(db: Db, maintenant: Date = new Date()): RappelEnvoye[] {
  const envoyes: RappelEnvoye[] = []
  const minute = minuteDuJour(maintenant)

  const toursOuverts = db
    .select({ round: rounds, tontine: tontines })
    .from(rounds)
    .innerJoin(tontines, eq(tontines.id, rounds.tontineId))
    .where(and(eq(rounds.status, 'collecting'), eq(tontines.status, 'running')))
    .all()

  for (const { round, tontine } of toursOuverts) {
    const echeance = new Date(`${round.dueDate}T00:00:00Z`)
    const jour = new Date(Date.UTC(
      maintenant.getUTCFullYear(), maintenant.getUTCMonth(), maintenant.getUTCDate(),
    ))
    const joursAvant = Math.round((echeance.getTime() - jour.getTime()) / 86_400_000)

    if (!JOURS_DE_RAPPEL.includes(joursAvant)) continue

    const aRelancer = db
      .select({ membershipId: contributions.membershipId, userId: memberships.userId })
      .from(contributions)
      .innerJoin(memberships, eq(memberships.id, contributions.membershipId))
      .where(and(
        eq(contributions.roundId, round.id),
        inArray(contributions.status, ['due', 'late']),
      ))
      .all()

    // Un membre à double part n'est relancé qu'une fois : deux notifications
    // identiques à la seconde près donnent l'impression d'un bug.
    const destinataires = new Set(aRelancer.map(r => r.userId).filter(Boolean) as string[])

    for (const userId of destinataires) {
      const prefs = preferencesDe(db, userId, tontine.id)
      if (!prefs.remindersEnabled) continue

      if (estEnSilence(
        { start: prefs.quietHoursStart, end: prefs.quietHoursEnd },
        minute,
      )) continue

      notifier(db, userId, {
        type: 'rappel_cotisation',
        tontineId: tontine.id,
        title: joursAvant === 0 ? 'Ta cotisation est due aujourd’hui' : 'Ta cotisation approche',
        // Aucun montant (règle 21) : la notification s'affiche sur un écran
        // verrouillé, et les téléphones se partagent.
        body: joursAvant === 0
          ? 'C’est le jour de la cotisation pour ta tontine.'
          : 'Ta cotisation est attendue dans deux jours.',
        url: `/app/tontine/${tontine.id}/cotiser`,
      })

      envoyes.push({ userId, tontineId: tontine.id, joursAvant })
    }
  }

  return envoyes
}

export interface RelanceWhatsApp {
  membershipId: string
  nom: string
  msisdn: string | null
  /** Le lien `wa.me` avec le message pré-rempli. */
  url: string | null
  message: string
}

/**
 * Liens WhatsApp pré-remplis pour relancer les retardataires.
 *
 * **L'envoi reste manuel**, et l'interface le dit sans ambiguïté. Ce n'est pas
 * une limitation technique qu'on contournera plus tard : une relance envoyée
 * automatiquement au nom du trésorier détruirait la seule chose qui fait
 * fonctionner une tontine — le fait que ce soit une personne qui parle à une
 * autre. Le bureau relit, choisit son ton, et décide qui il relance.
 *
 * Le message **ne contient pas de montant** : il part sur WhatsApp, qui affiche
 * un aperçu sur l'écran verrouillé, comme une notification.
 */
export function relancesWhatsApp(db: Db, tontineId: string): RelanceWhatsApp[] {
  const [tontine] = db.select().from(tontines).where(eq(tontines.id, tontineId)).limit(1).all()
  if (!tontine) return []

  const [tourOuvert] = db
    .select()
    .from(rounds)
    .where(and(eq(rounds.tontineId, tontineId), eq(rounds.status, 'collecting')))
    .orderBy(asc(rounds.index))
    .limit(1)
    .all()

  if (!tourOuvert) return []

  const retardataires = db
    .select({
      membershipId: memberships.id,
      managedName: memberships.managedName,
      managedPhone: memberships.managedPhone,
      firstName: users.firstName,
      lastName: users.lastName,
      phone: users.phone,
    })
    .from(contributions)
    .innerJoin(memberships, eq(memberships.id, contributions.membershipId))
    .innerJoin(shares, eq(shares.id, contributions.shareId))
    .leftJoin(users, eq(users.id, memberships.userId))
    .where(and(
      eq(contributions.roundId, tourOuvert.id),
      inArray(contributions.status, ['due', 'late']),
    ))
    .all()

  const vus = new Set<string>()

  return retardataires
    .filter((r) => {
      if (vus.has(r.membershipId)) return false
      vus.add(r.membershipId)
      return true
    })
    .map((r) => {
      const nom = [r.firstName, r.lastName].filter(Boolean).join(' ') || r.managedName || 'Membre'
      const msisdn = r.phone ?? r.managedPhone ?? null
      const prenom = nom.split(' ')[0]

      const message = `Bonjour ${prenom}, c'est pour la tontine « ${tontine.name} ». `
        + `La cotisation du tour ${tourOuvert.index} est attendue. `
        + 'Merci de me dire où tu en es.'

      return {
        membershipId: r.membershipId,
        nom,
        msisdn,
        message,
        // `wa.me` accepte le numéro sans le « + ».
        url: msisdn
          ? `https://wa.me/${msisdn.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`
          : null,
      }
    })
}
