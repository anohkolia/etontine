import { eq } from 'drizzle-orm'
import webpush from 'web-push'
import type { useDb } from '../db/index.ts'
import { notifications, pushSubscriptions } from '../db/schema.ts'
import { isProduction } from '../utils/env.ts'

type Db = ReturnType<typeof useDb>

let configure = false

/**
 * Configure VAPID une seule fois.
 *
 * Sans clés, on ne lève pas : le push est un confort, pas le cœur du produit.
 * Les notifications restent enregistrées en base et lisibles dans
 * `/app/notifications`. Faire échouer une confirmation de cotisation parce
 * qu'une clé VAPID manque serait absurde.
 */
function preparer(): boolean {
  if (configure) return true

  const publique = process.env.NUXT_VAPID_PUBLIC_KEY
  const privee = process.env.NUXT_VAPID_PRIVATE_KEY
  const contact = process.env.NUXT_VAPID_SUBJECT ?? 'mailto:contact@tontine.ci'

  if (!publique || !privee) return false

  webpush.setVapidDetails(contact, publique, privee)
  configure = true
  return true
}

/**
 * Envoie une notification déjà enregistrée vers les abonnements push du membre.
 *
 * Le contenu vient de la table `notifications`, où la règle 21 a déjà été
 * appliquée à l'écriture : **aucun montant ne peut arriver jusqu'ici**. C'est
 * le point de la conception — le filtre est en amont, à l'endroit unique où les
 * notifications naissent, pas dispersé à chaque appel.
 */
export async function pousserNotification(db: Db, notificationId: string): Promise<number> {
  const [notification] = db
    .select()
    .from(notifications)
    .where(eq(notifications.id, notificationId))
    .limit(1)
    .all()

  if (!notification) return 0
  if (!preparer()) {
    if (!isProduction()) console.info('[push] clés VAPID absentes — notification gardée en base')
    return 0
  }

  const abonnements = db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, notification.userId))
    .all()

  const charge = JSON.stringify({
    title: notification.title,
    body: notification.body,
    url: notification.url,
  })

  let envoyees = 0

  for (const abonnement of abonnements) {
    try {
      await webpush.sendNotification(
        {
          endpoint: abonnement.endpoint,
          keys: { p256dh: abonnement.p256dh, auth: abonnement.auth },
        },
        charge,
      )
      envoyees++
    }
    catch (erreur) {
      // 404 ou 410 : l'abonnement est mort, le navigateur a été réinstallé ou
      // les notifications coupées. On le retire plutôt que de réessayer
      // indéfiniment.
      const statut = (erreur as { statusCode?: number }).statusCode
      if (statut === 404 || statut === 410) {
        db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, abonnement.id)).run()
      }
    }
  }

  if (envoyees > 0) {
    db.update(notifications).set({ sentAt: new Date() }).where(eq(notifications.id, notificationId)).run()
  }

  return envoyees
}
