/*
 * Réception des notifications push.
 *
 * Chargé par `importScripts` depuis le service worker que Workbox génère : la
 * stratégie `generateSW` reste en place, avec son précache et sa règle
 * `NetworkOnly` sur `/api/v1/` (règle 12). Basculer en `injectManifest` pour
 * deux écouteurs aurait demandé de réécrire toute la mise en cache qui fait
 * marcher l'application hors ligne.
 *
 * Le contenu affiché vient tel quel du serveur, où la règle 21 a déjà été
 * appliquée à l'écriture : aucun montant ne peut arriver jusqu'ici.
 */
self.addEventListener('push', (event) => {
  if (!event.data) return

  let charge
  try {
    charge = event.data.json()
  }
  catch {
    return
  }

  event.waitUntil(
    self.registration.showNotification(charge.title ?? 'eTontine', {
      body: charge.body ?? '',
      icon: '/icones/icone-192.png',
      badge: '/icones/icone-192.png',
      // Regroupe par tontine : trois rappels de la même tontine remplacent le
      // précédent au lieu d'empiler trois lignes sur l'écran de verrouillage.
      tag: charge.tontineId ?? 'etontine',
      data: { url: charge.url ?? '/app' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const cible = event.notification.data?.url ?? '/app'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((fenetres) => {
      // Une application déjà ouverte est réutilisée : en ouvrir une seconde
      // perdrait la saisie en cours.
      for (const fenetre of fenetres) {
        if ('focus' in fenetre) {
          fenetre.navigate?.(cible)
          return fenetre.focus()
        }
      }
      return self.clients.openWindow(cible)
    }),
  )
})
